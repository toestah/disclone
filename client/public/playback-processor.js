class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._peers = new Map();
    this._prefillSamples = Math.round(sampleRate * 0.08); // 80ms prefill
    this._underrunLimit = Math.ceil(sampleRate * 0.1 / 128); // ~100ms

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
          peer = { ring: new Float32Array(size), size, w: 0, r: 0, started: false, underruns: 0 };
          this._peers.set(peerId, peer);
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

  process(inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) return true;
    output.fill(0);

    for (const [, peer] of this._peers) {
      const buffered = peer.w - peer.r;

      if (!peer.started) {
        if (buffered >= this._prefillSamples) {
          peer.started = true;
          peer.underruns = 0;
        } else {
          continue;
        }
      }

      let hasData = false;
      for (let i = 0; i < output.length; i++) {
        if (peer.r < peer.w) {
          output[i] += peer.ring[peer.r % peer.size];
          peer.r++;
          hasData = true;
        }
      }

      if (!hasData) {
        peer.underruns++;
        if (peer.underruns > this._underrunLimit) {
          peer.started = false;
          peer.underruns = 0;
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

    // Soft clip
    for (let i = 0; i < output.length; i++) {
      if (output[i] > 1) output[i] = 1;
      else if (output[i] < -1) output[i] = -1;
    }

    return true;
  }
}
registerProcessor('playback-processor', PlaybackProcessor);
