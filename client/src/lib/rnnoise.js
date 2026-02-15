// RNNoise WASM wrapper — AI-powered noise suppression
// Uses @jitsi/rnnoise-wasm (same approach as Jitsi Meet)
// RNNoise processes 480-sample frames at 48kHz (10ms each)

let modulePromise = null;

/**
 * Lazy-load the RNNoise WASM module (singleton).
 * Uses the async loader — only loaded when noise suppression is first enabled.
 */
export async function loadRnnoise() {
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    const { createRNNWasmModule } = await import('@jitsi/rnnoise-wasm');
    const Module = await createRNNWasmModule();
    Module._rnnoise_init();
    return Module;
  })();
  return modulePromise;
}

/**
 * RNNoise denoiser instance.
 * Manages WASM heap memory and provides a clean JS API.
 */
export class RnnoiseDenoiser {
  constructor(module) {
    this._module = module;
    this._state = module._rnnoise_create(0); // NULL = default model
    // Allocate 480-float buffers on WASM heap (480 * 4 bytes each)
    this._inputPtr = module._malloc(480 * 4);
    this._outputPtr = module._malloc(480 * 4);
    this._destroyed = false;
  }

  /**
   * Process a single 480-sample frame.
   * @param {Float32Array} frame - exactly 480 float32 samples
   * @returns {{ output: Float32Array, vadProb: number }} denoised samples + VAD probability
   */
  processFrame(frame) {
    if (this._destroyed) return { output: frame, vadProb: 0 };

    const M = this._module;
    const heapF32 = M.HEAPF32;
    const inputOffset = this._inputPtr >> 2; // byte offset → float offset
    const outputOffset = this._outputPtr >> 2;

    // Copy input to WASM heap
    heapF32.set(frame, inputOffset);

    // Process — returns VAD probability [0, 1]
    const vadProb = M._rnnoise_process_frame(this._state, this._outputPtr, this._inputPtr);

    // Copy output from WASM heap
    const output = new Float32Array(480);
    output.set(heapF32.subarray(outputOffset, outputOffset + 480));

    return { output, vadProb };
  }

  /**
   * Destroy the denoiser and free WASM heap memory.
   */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    const M = this._module;
    M._rnnoise_destroy(this._state);
    M._free(this._inputPtr);
    M._free(this._outputPtr);
    this._state = null;
    this._inputPtr = null;
    this._outputPtr = null;
  }
}

/**
 * Process a 20ms audio frame through RNNoise.
 * Handles the 20ms → 2x10ms split and rate conversion if needed.
 *
 * @param {RnnoiseDenoiser} denoiser - active denoiser instance
 * @param {Float32Array} frame - 20ms frame at inputRate
 * @param {number} inputRate - sample rate of the frame (e.g., 48000, 44100)
 * @returns {Float32Array} denoised frame at the original inputRate
 */
export function denoiseFrame(denoiser, frame, inputRate) {
  if (!denoiser || denoiser._destroyed) return frame;

  // RNNoise requires 48kHz, 480-sample frames (10ms)
  const RNNOISE_RATE = 48000;
  const RNNOISE_FRAME = 480;

  let workFrame = frame;

  // Resample to 48kHz if needed
  if (inputRate !== RNNOISE_RATE) {
    const ratio = inputRate / RNNOISE_RATE;
    const outLen = Math.round(frame.length / ratio);
    workFrame = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const srcIdx = i * ratio;
      const idx0 = Math.floor(srcIdx);
      const idx1 = Math.min(idx0 + 1, frame.length - 1);
      const frac = srcIdx - idx0;
      workFrame[i] = frame[idx0] + (frame[idx1] - frame[idx0]) * frac;
    }
  }

  // Process in 480-sample chunks
  const numChunks = Math.floor(workFrame.length / RNNOISE_FRAME);
  const denoisedWork = new Float32Array(workFrame.length);

  for (let c = 0; c < numChunks; c++) {
    const chunk = workFrame.subarray(c * RNNOISE_FRAME, (c + 1) * RNNOISE_FRAME);
    const { output } = denoiser.processFrame(chunk);
    denoisedWork.set(output, c * RNNOISE_FRAME);
  }

  // Copy any remaining samples (< 480) unprocessed
  const processed = numChunks * RNNOISE_FRAME;
  if (processed < workFrame.length) {
    denoisedWork.set(workFrame.subarray(processed), processed);
  }

  // Resample back to original rate if needed
  if (inputRate !== RNNOISE_RATE) {
    const ratio = RNNOISE_RATE / inputRate;
    const outLen = frame.length;
    const result = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const srcIdx = i * ratio;
      const idx0 = Math.floor(srcIdx);
      const idx1 = Math.min(idx0 + 1, denoisedWork.length - 1);
      const frac = srcIdx - idx0;
      result[i] = denoisedWork[idx0] + (denoisedWork[idx1] - denoisedWork[idx0]) * frac;
    }
    return result;
  }

  return denoisedWork;
}
