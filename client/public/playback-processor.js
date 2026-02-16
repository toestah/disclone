class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._peers = new Map();
    this._basePrefillSamples = Math.round(sampleRate * 0.2);  // 200ms base prefill
    this._maxPrefillSamples = Math.round(sampleRate * 0.35);  // 350ms cap
    this._prefillStep = Math.round(sampleRate * 0.04);         // 40ms increment per repeated underrun
    this._fadeInLength = Math.round(sampleRate * 0.005);       // 5ms fade-in
    this._decay = Math.exp(-1 / (sampleRate * 0.003));         // 3ms exponential decay
    this._frameSamples = Math.round(sampleRate * 0.02);        // 20ms frame for PLC
    this._maxPlcRepeats = 3;                                   // Up to 3 PLC frames (60ms) — short, clean fade
    this._plcFadeInLength = Math.round(sampleRate * 0.003);    // 3ms fade-in on PLC frames
    this._peerCounter = 0;                                     // for pan position assignment

    // PLC lowpass coefficients — progressively filter repeated frames
    // so they sound like natural trail-off instead of robotic repetition.
    // Starts at 4kHz (already muffled) and halves each frame.
    this._plcLpCoeffs = [];
    for (let i = 0; i < this._maxPlcRepeats; i++) {
      const fc = 4000 / Math.pow(2, i);
      this._plcLpCoeffs.push(1 - Math.exp(-2 * Math.PI * fc / sampleRate));
    }

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
            lastFrame: new Float32Array(this._frameSamples), // pre-allocated 20ms frame
            lastFrameLen: 0,       // actual length of data in lastFrame
            plcCount: 0,           // consecutive PLC frames emitted
            plcFadeIn: 0,          // fade-in counter for PLC frames
            plcLpState: 0,         // 1-pole lowpass state for PLC smoothing
            // Stereo panning (equal-power)
            panLeft: Math.cos(angle + Math.PI / 4),
            panRight: Math.sin(angle + Math.PI / 4),
          };
          this._peers.set(peerId, peer);
        }

        // Real data arrived — exit draining mode, resume immediately
        if (peer.draining) {
          peer.draining = false;
          if (!peer.started) {
            peer.started = true;
            peer.fadeIn = this._fadeInLength; // 5ms fade-in on resume
          }
        }

        // Reset PLC counter and state on real data
        peer.plcCount = 0;
        peer.plcFadeIn = 0;
        peer.plcLpState = 0;

        // Store last frame for PLC (last ~20ms of incoming data) — reuse pre-allocated buffer
        if (pcm.length >= this._frameSamples) {
          peer.lastFrame.set(pcm.subarray(pcm.length - this._frameSamples));
          peer.lastFrameLen = this._frameSamples;
        } else {
          peer.lastFrame.set(pcm);
          peer.lastFrameLen = pcm.length;
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
   * If multiple underruns within 5 seconds, increase prefill by 40ms steps.
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

          // Stereo panning
          left[i] += sample * peer.panLeft;
          right[i] += sample * peer.panRight;
          peer.lastSample = sample;
          hasData = true;
        } else {
          // Underrun — generate PLC inline so it plays THIS quantum, not next
          if (peer.lastFrameLen > 0 && peer.plcCount < this._maxPlcRepeats) {
            // Steep exponential decay + aggressive lowpass → fast, clean trail-off
            const gain = Math.pow(0.55, peer.plcCount + 1);
            const alpha = this._plcLpCoeffs[peer.plcCount];
            let lpState = peer.plcLpState;
            for (let j = 0; j < peer.lastFrameLen; j++) {
              const sample = peer.lastFrame[j] * gain;
              lpState += alpha * (sample - lpState);
              peer.ring[peer.w % peer.size] = lpState;
              peer.w++;
            }
            peer.plcLpState = lpState;
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
          }
          // No comfort noise — clean silence between speech segments
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
