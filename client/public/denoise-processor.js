// RNNoise denoise AudioWorklet processor
// Accumulates 128-sample render quanta into 480-sample frames (10ms at 48kHz),
// posts them to main thread for RNNoise WASM processing, receives denoised
// frames back, and outputs from a FIFO queue. ~10ms added latency.

class DenoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._enabled = false; // Start in bypass — enabled after RNNoise loads
    this._inputBuf = new Float32Array(480);
    this._inputPos = 0;

    // Output FIFO: queue of Float32Array(480) frames from main thread
    this._outputQueue = [];
    this._outputFrame = null; // Current frame being read
    this._outputPos = 0;      // Read position within current frame

    this.port.onmessage = (e) => {
      if (e.data.denoised) {
        // Safety: cap queue at ~200ms to prevent runaway memory
        if (this._outputQueue.length > 20) {
          this._outputQueue.length = 0;
          this._outputFrame = null;
          this._outputPos = 0;
        }
        this._outputQueue.push(e.data.denoised);
      }
      if (e.data.enabled !== undefined) {
        this._enabled = e.data.enabled;
        // Reset buffers for clean transition
        this._inputPos = 0;
        this._outputQueue.length = 0;
        this._outputFrame = null;
        this._outputPos = 0;
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) return true;

    // Bypass mode: zero-latency passthrough
    if (!this._enabled) {
      output.set(input);
      return true;
    }

    // ── Input side: accumulate 128-sample quanta into 480-sample frames ──
    for (let i = 0; i < input.length; i++) {
      this._inputBuf[this._inputPos++] = input[i];
      if (this._inputPos >= 480) {
        // Send frame to main thread for RNNoise processing
        const frame = new Float32Array(480);
        frame.set(this._inputBuf);
        this.port.postMessage({ frame }, [frame.buffer]);
        this._inputPos = 0;
      }
    }

    // ── Output side: read 128 samples from denoised frame queue ──
    let written = 0;
    while (written < output.length) {
      // Advance to next frame if current is exhausted
      if (!this._outputFrame || this._outputPos >= this._outputFrame.length) {
        if (this._outputQueue.length > 0) {
          this._outputFrame = this._outputQueue.shift();
          this._outputPos = 0;
        } else {
          // Queue underrun (startup latency or main thread lag) — output silence
          for (let i = written; i < output.length; i++) {
            output[i] = 0;
          }
          return true;
        }
      }

      const available = this._outputFrame.length - this._outputPos;
      const needed = output.length - written;
      const toCopy = Math.min(available, needed);

      for (let i = 0; i < toCopy; i++) {
        output[written + i] = this._outputFrame[this._outputPos + i];
      }

      this._outputPos += toCopy;
      written += toCopy;
    }

    return true;
  }
}

registerProcessor('denoise-processor', DenoiseProcessor);
