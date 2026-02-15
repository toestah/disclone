class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._peers = new Map();
    this._basePrefillSamples = Math.round(sampleRate * 0.08); // 80ms base prefill
    this._maxPrefillSamples = Math.round(sampleRate * 0.15);  // 150ms cap
    this._prefillStep = Math.round(sampleRate * 0.02);        // 20ms increment per repeated underrun
    this._fadeInLength = Math.round(sampleRate * 0.005);       // 5ms fade-in
    this._decay = Math.exp(-1 / (sampleRate * 0.003));         // 3ms exponential decay
    this._frameSamples = Math.round(sampleRate * 0.02);        // 20ms frame for PLC
    this._maxPlcRepeats = 6;                                   // Up to 6 PLC frames (120ms)

    this.port.onmessage = (e) => {
      const { peerId, pcm, removePeer, clear } = e.data;

      if (clear) {
        this._peers.clear();
        return;
      }
      if (removePeer) {
        this._peers.delete(removePeer);
        return;
      }
      if (pcm && peerId !== undefined) {
        let peer = this._peers.get(peerId);
        if (!peer) {
          const size = sampleRate * 2; // 2s ring buffer
          peer = {
            ring: new Float32Array(size), size, w: 0, r: 0,
            started: false, underruns: 0,
            lastSample: 0, fadeIn: 0,
            // Adaptive prefill
            prefillSamples: this._basePrefillSamples,
            underrunHistory: [],   // timestamps of recent underruns
            draining: false,       // draining mode instead of hard reset
            // Worklet-level PLC
            lastFrame: null,       // last 20ms frame for repetition
            plcCount: 0,           // consecutive PLC frames emitted
          };
          this._peers.set(peerId, peer);
        }

        // Real data arrived — exit draining mode, resume immediately
        if (peer.draining) {
          peer.draining = false;
          if (!peer.started) {
            peer.started = true;
            peer.fadeIn = this._fadeInLength; // 3ms fade-in on resume
          }
        }

        // Reset PLC counter on real data
        peer.plcCount = 0;

        // Store last frame for PLC (last ~20ms of incoming data)
        if (pcm.length >= this._frameSamples) {
          peer.lastFrame = pcm.slice(pcm.length - this._frameSamples);
        } else {
          peer.lastFrame = new Float32Array(pcm);
        }

        for (let i = 0; i < pcm.length; i++) {
          peer.ring[peer.w % peer.size] = pcm[i];
          peer.w++;
        }
        // Handle overflow (writer lapped reader)
        if (peer.w - peer.r > peer.size) {
          peer.r = peer.w - peer.size;
        }
      }
    };
  }

  /**
   * Adapt prefill size based on underrun frequency.
   * If multiple underruns within 5 seconds, increase prefill by 20ms steps (cap 150ms).
   */
  _adaptPrefill(peer, now) {
    peer.underrunHistory.push(now);
    // Keep only underruns from last 5 seconds
    const cutoff = now - 5;
    peer.underrunHistory = peer.underrunHistory.filter((t) => t >= cutoff);
    // If 2+ underruns in 5s, increase prefill
    if (peer.underrunHistory.length >= 2) {
      peer.prefillSamples = Math.min(
        peer.prefillSamples + this._prefillStep,
        this._maxPrefillSamples
      );
    }
  }

  process(inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) return true;
    output.fill(0);

    const now = currentTime; // AudioWorklet global

    for (const [, peer] of this._peers) {
      const buffered = peer.w - peer.r;

      if (!peer.started) {
        if (buffered >= peer.prefillSamples) {
          peer.started = true;
          peer.underruns = 0;
          peer.fadeIn = this._fadeInLength;
          peer.plcCount = 0;
        } else {
          continue;
        }
      }

      let hasData = false;
      for (let i = 0; i < output.length; i++) {
        if (peer.r < peer.w) {
          let sample = peer.ring[peer.r % peer.size];
          peer.r++;

          // Fade-in after prefill to avoid click
          if (peer.fadeIn > 0) {
            sample *= 1 - (peer.fadeIn / this._fadeInLength);
            peer.fadeIn--;
          }

          output[i] += sample;
          peer.lastSample = sample;
          hasData = true;
        } else if (Math.abs(peer.lastSample) > 0.0001) {
          // Smooth exponential decay to zero when data runs out
          peer.lastSample *= this._decay;
          output[i] += peer.lastSample;
        }
      }

      if (!hasData) {
        peer.underruns++;

        // Worklet-level PLC: repeat last frame with progressive fadeout
        if (peer.lastFrame && peer.plcCount < this._maxPlcRepeats) {
          const gain = 1.0 - (peer.plcCount / this._maxPlcRepeats) * 0.8; // 100% → 20%
          for (let i = 0; i < peer.lastFrame.length; i++) {
            peer.ring[peer.w % peer.size] = peer.lastFrame[i] * gain;
            peer.w++;
          }
          if (peer.w - peer.r > peer.size) {
            peer.r = peer.w - peer.size;
          }
          peer.plcCount++;
        }

        // Instead of hard reset, enter draining mode
        // Adaptive prefill: track underrun frequency
        if (peer.underruns === 1) {
          this._adaptPrefill(peer, now);
        }

        // After extended underrun (PLC exhausted), enter draining mode
        const plcDurationQuanta = Math.ceil(this._maxPlcRepeats * this._frameSamples / 128);
        if (peer.underruns > plcDurationQuanta) {
          peer.draining = true;
          // Do NOT reset started — resume immediately when data arrives
          peer.lastSample = 0;
        }
      } else {
        peer.underruns = 0;
      }

      // Prevent position overflow
      if (peer.r > peer.size * 10) {
        const off = peer.r - (peer.r % peer.size);
        peer.r -= off;
        peer.w -= off;
      }
    }

    // Soft clip — linear below +/-0.9, smooth saturation above
    // Avoids harsh odd-harmonic distortion from hard clipping during multi-peer mixing
    for (let i = 0; i < output.length; i++) {
      const x = output[i];
      if (x > 0.9) {
        const over = x - 0.9;
        output[i] = 0.9 + 0.1 * (1 - 1 / (1 + over * 10));
      } else if (x < -0.9) {
        const over = -x - 0.9;
        output[i] = -0.9 - 0.1 * (1 - 1 / (1 + over * 10));
      }
    }

    return true;
  }
}
registerProcessor('playback-processor', PlaybackProcessor);
