class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._frameSize = Math.round(sampleRate * 0.02); // 20ms
    this._buffer = new Float32Array(this._frameSize);
    this._offset = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input) return true;

    // Pass-through so downstream nodes (analyser) stay active
    if (output) output.set(input);

    for (let i = 0; i < input.length; i++) {
      this._buffer[this._offset++] = input[i];
      if (this._offset >= this._frameSize) {
        // Skip true silence
        let peak = 0;
        for (let j = 0; j < this._frameSize; j++) {
          const a = Math.abs(this._buffer[j]);
          if (a > peak) peak = a;
        }
        if (peak > 0.001) {
          this.port.postMessage({ pcm: this._buffer.slice() });
        }
        this._offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
