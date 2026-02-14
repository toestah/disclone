class MusicCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._frameSize = Math.round(sampleRate * 0.02); // 20ms
    this._leftBuf = new Float32Array(this._frameSize);
    this._rightBuf = new Float32Array(this._frameSize);
    this._offset = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const left = input[0];
    const right = input[1] || left; // mono → duplicate to both channels

    // Pass-through to keep audio graph alive
    const output = outputs[0];
    if (output) {
      if (output[0]) output[0].set(left);
      if (output[1]) output[1].set(right);
    }

    for (let i = 0; i < left.length; i++) {
      this._leftBuf[this._offset] = left[i];
      this._rightBuf[this._offset] = right[i];
      this._offset++;
      if (this._offset >= this._frameSize) {
        // Silence gate — skip true silence to save bandwidth
        let peak = 0;
        for (let j = 0; j < this._frameSize; j++) {
          const al = Math.abs(this._leftBuf[j]);
          const ar = Math.abs(this._rightBuf[j]);
          if (al > peak) peak = al;
          if (ar > peak) peak = ar;
        }
        if (peak > 0.0001) {
          const l = this._leftBuf.slice();
          const r = this._rightBuf.slice();
          this.port.postMessage({ left: l, right: r }, [l.buffer, r.buffer]);
        }
        this._offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('music-capture-processor', MusicCaptureProcessor);
