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
    this._plcFadeInLength = Math.round(sampleRate * 0.003);    // 3ms fade-in on PLC frames
    this._peerCounter = 0;                                     // for pan position assignment
    this._comfortNoiseLevel = Math.pow(10, -45 / 20);           // -45 dBFS
    this._comfortNoiseFadeLen = Math.round(sampleRate * 0.05);  // 50ms fade in/out

    // Pre-computed pan positions: spread peers across stereo field
    // Pattern: center, left, right, slight-left, slight-right, far-left, far-right...
    this._panPositions = [0, -0.4, 0.4, -0.2, 0.2, -0.6, 0.6, -0.1, 0.1, -0.5, 0.5, -0.3, 0.3,
      -0.55, 0.55, -0.15, 0.15, -0.45, 0.45, -0.35, 0.35];

    this.port.onmessage = (e) => {
      const { peerId, pcm, removePeer, clear, setPan } = e.data;

      if (clear) {
        this._peers.clear();
        this._peerCounter = 0;
        return;
      }
      if (removePeer) {
        this._peers.delete(removePeer);
        return;
      }
      if (setPan !== undefined && peerId !== undefined) {
        const peer = this._peers.get(peerId);
        if (peer) {
          // Equal-power panning: panLeft and panRight gains
          const angle = (setPan * Math.PI) / 4; // -0.6..0.6 → -PI/4*0.6..PI/4*0.6
          peer.panLeft = Math.cos(angle + Math.PI / 4);
          peer.panRight = Math.sin(angle + Math.PI / 4);
        }
        return;
      }
      if (pcm && peerId !== undefined) {
        let peer = this._peers.get(peerId);
        if (!peer) {
          const size = sampleRate * 2; // 2s ring buffer
          // Assign pan position from pre-computed list
          const panIdx = this._peerCounter % this._panPositions.length;
          const pan = this._panPositions[panIdx];
          const angle = (pan * Math.PI) / 4;
          this._peerCounter++;
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
            plcFadeIn: 0,          // fade-in counter for PLC frames
            // Stereo panning (equal-power)
            panLeft: Math.cos(angle + Math.PI / 4),
            panRight: Math.sin(angle + Math.PI / 4),
            // Comfort noise
            cnFade: 0,             // current fade position (0 = silent, fadeLen = full)
            cnActive: false,       // whether comfort noise is active
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

        // Reset PLC counter and fade-in on real data
        peer.plcCount = 0;
        peer.plcFadeIn = 0;

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
    const left = outputs[0]?.[0];
    const right = outputs[0]?.[1];
    if (!left || !right) return true;
    left.fill(0);
    right.fill(0);

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
      for (let i = 0; i < left.length; i++) {
        if (peer.r < peer.w) {
          let sample = peer.ring[peer.r % peer.size];
          peer.r++;

          // Fade-in after prefill to avoid click
          if (peer.fadeIn > 0) {
            sample *= 1 - (peer.fadeIn / this._fadeInLength);
            peer.fadeIn--;
          }

          // PLC fade-in: smooth transition from decay into PLC data
          if (peer.plcFadeIn > 0) {
            sample *= 1 - (peer.plcFadeIn / this._plcFadeInLength);
            peer.plcFadeIn--;
          }

          // Fade out comfort noise when real data resumes
          if (peer.cnActive) {
            peer.cnFade = Math.max(0, peer.cnFade - 1);
            if (peer.cnFade === 0) peer.cnActive = false;
          }

          // Stereo panning
          left[i] += sample * peer.panLeft;
          right[i] += sample * peer.panRight;
          peer.lastSample = sample;
          hasData = true;
        } else {
          // Underrun — generate PLC inline so it plays THIS quantum, not next
          if (peer.lastFrame && peer.plcCount < this._maxPlcRepeats) {
            const gain = 1.0 - (peer.plcCount / this._maxPlcRepeats) * 0.8; // 100% → 20%
            for (let j = 0; j < peer.lastFrame.length; j++) {
              peer.ring[peer.w % peer.size] = peer.lastFrame[j] * gain;
              peer.w++;
            }
            if (peer.w - peer.r > peer.size) {
              peer.r = peer.w - peer.size;
            }
            peer.plcFadeIn = this._plcFadeInLength; // 3ms fade-in on PLC
            peer.plcCount++;
            // Retry this sample from the now-populated buffer
            i--;
            continue;
          } else if (Math.abs(peer.lastSample) > 0.0001) {
            // Smooth exponential decay to zero when PLC exhausted
            peer.lastSample *= this._decay;
            left[i] += peer.lastSample * peer.panLeft;
            right[i] += peer.lastSample * peer.panRight;
          } else if (peer.started && !peer.draining) {
            // Comfort noise: low-level shaped noise so channel feels "alive"
            peer.cnActive = true;
            peer.cnFade = Math.min(peer.cnFade + 1, this._comfortNoiseFadeLen);
            const gain = this._comfortNoiseLevel * (peer.cnFade / this._comfortNoiseFadeLen);
            // Simple pink-ish noise: average 2 white samples for -3dB/octave rolloff
            const w1 = Math.random() * 2 - 1;
            const w2 = Math.random() * 2 - 1;
            const noise = (w1 + w2) * 0.5 * gain;
            left[i] += noise * peer.panLeft;
            right[i] += noise * peer.panRight;
          }
        }
      }

      if (!hasData) {
        peer.underruns++;

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

    // Soft clip both channels — linear below +/-0.9, smooth saturation above
    for (let i = 0; i < left.length; i++) {
      for (const ch of [left, right]) {
        const x = ch[i];
        if (x > 0.9) {
          const over = x - 0.9;
          ch[i] = 0.9 + 0.1 * (1 - 1 / (1 + over * 10));
        } else if (x < -0.9) {
          const over = -x - 0.9;
          ch[i] = -0.9 - 0.1 * (1 - 1 / (1 + over * 10));
        }
      }
    }

    return true;
  }
}
registerProcessor('playback-processor', PlaybackProcessor);
