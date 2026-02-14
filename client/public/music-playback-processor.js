class MusicPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const size = sampleRate * 2; // 2s ring buffer per channel
    this._size = size;
    this._leftRing = new Float32Array(size);
    this._rightRing = new Float32Array(size);
    this._w = 0;
    this._r = 0;
    this._started = false;
    this._underruns = 0;
    this._prefillSamples = Math.round(sampleRate * 0.3); // 300ms prefill
    this._underrunLimit = Math.ceil(sampleRate * 0.1 / 128); // ~100ms
    this._fadeInLength = Math.round(sampleRate * 0.01); // 10ms fade-in
    this._decay = Math.exp(-1 / (sampleRate * 0.005)); // 5ms exponential decay
    this._fadeIn = 0;
    this._lastLeft = 0;
    this._lastRight = 0;

    this.port.onmessage = (e) => {
      const { left, right, clear } = e.data;

      if (clear) {
        this._leftRing.fill(0);
        this._rightRing.fill(0);
        this._w = 0;
        this._r = 0;
        this._started = false;
        this._underruns = 0;
        this._lastLeft = 0;
        this._lastRight = 0;
        this._fadeIn = 0;
        return;
      }

      if (left && right) {
        for (let i = 0; i < left.length; i++) {
          this._leftRing[this._w % this._size] = left[i];
          this._rightRing[this._w % this._size] = right[i];
          this._w++;
        }
        // Handle overflow (writer lapped reader)
        if (this._w - this._r > this._size) {
          this._r = this._w - this._size;
        }
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const outLeft = output?.[0];
    const outRight = output?.[1];
    if (!outLeft || !outRight) return true;

    outLeft.fill(0);
    outRight.fill(0);

    const buffered = this._w - this._r;

    if (!this._started) {
      if (buffered >= this._prefillSamples) {
        this._started = true;
        this._underruns = 0;
        this._fadeIn = this._fadeInLength;
      } else {
        return true;
      }
    }

    let hasData = false;
    for (let i = 0; i < outLeft.length; i++) {
      if (this._r < this._w) {
        let l = this._leftRing[this._r % this._size];
        let r = this._rightRing[this._r % this._size];
        this._r++;

        // Fade-in after prefill
        if (this._fadeIn > 0) {
          const gain = 1 - (this._fadeIn / this._fadeInLength);
          l *= gain;
          r *= gain;
          this._fadeIn--;
        }

        outLeft[i] = l;
        outRight[i] = r;
        this._lastLeft = l;
        this._lastRight = r;
        hasData = true;
      } else if (Math.abs(this._lastLeft) > 0.0001 || Math.abs(this._lastRight) > 0.0001) {
        // Smooth exponential decay on underrun
        this._lastLeft *= this._decay;
        this._lastRight *= this._decay;
        outLeft[i] = this._lastLeft;
        outRight[i] = this._lastRight;
      }
    }

    if (!hasData) {
      this._underruns++;
      if (this._underruns > this._underrunLimit) {
        this._started = false;
        this._underruns = 0;
        this._lastLeft = 0;
        this._lastRight = 0;
      }
    } else {
      this._underruns = 0;
    }

    // Prevent position overflow
    if (this._r > this._size * 10) {
      const off = this._r - (this._r % this._size);
      this._r -= off;
      this._w -= off;
    }

    // Soft clip
    for (let i = 0; i < outLeft.length; i++) {
      if (outLeft[i] > 1) outLeft[i] = 1;
      else if (outLeft[i] < -1) outLeft[i] = -1;
      if (outRight[i] > 1) outRight[i] = 1;
      else if (outRight[i] < -1) outRight[i] = -1;
    }

    return true;
  }
}
registerProcessor('music-playback-processor', MusicPlaybackProcessor);
