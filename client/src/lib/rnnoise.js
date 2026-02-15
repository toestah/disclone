// RNNoise WASM wrapper — AI-powered noise suppression
// Uses @jitsi/rnnoise-wasm (same approach as Jitsi Meet)
// RNNoise processes 480-sample frames at 48kHz (10ms each)

let modulePromise = null;

/**
 * Lazy-load the RNNoise WASM module (singleton).
 * Uses the sync version with inlined base64 WASM to avoid file-serving issues in Vite.
 * The "sync" loader still returns a ready promise but doesn't need to fetch any files.
 */
export async function loadRnnoise() {
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    const { createRNNWasmModuleSync } = await import('@jitsi/rnnoise-wasm');
    const instance = createRNNWasmModuleSync();
    // The sync loader inlines the WASM but still uses a ready promise
    const Module = await instance.ready;
    // Note: do NOT call Module._rnnoise_init() — it corrupts internal state
    // and disables denoising. _rnnoise_create() handles per-instance init.
    return Module;
  })();
  // Clear cached promise on failure so retries work
  modulePromise.catch(() => { modulePromise = null; });
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

    // RNNoise expects int16-scale values (-32768 to 32767), not float32 (-1 to 1)
    // Scale up before processing, scale back down after
    for (let i = 0; i < 480; i++) {
      heapF32[inputOffset + i] = frame[i] * 32768;
    }

    // Process — returns VAD probability [0, 1]
    const vadProb = M._rnnoise_process_frame(this._state, this._outputPtr, this._inputPtr);

    // Copy output from WASM heap and scale back to float32 range
    const output = new Float32Array(480);
    for (let i = 0; i < 480; i++) {
      output[i] = heapF32[outputOffset + i] / 32768;
    }

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
 * @returns {{ pcm: Float32Array, vadProb: number }} denoised frame + average VAD probability
 */
export function denoiseFrame(denoiser, frame, inputRate) {
  if (!denoiser || denoiser._destroyed) return { pcm: frame, vadProb: 0 };

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

  // Process in 480-sample chunks, accumulate VAD probability
  const numChunks = Math.floor(workFrame.length / RNNOISE_FRAME);
  const denoisedWork = new Float32Array(workFrame.length);
  let vadProbSum = 0;

  for (let c = 0; c < numChunks; c++) {
    const chunk = workFrame.subarray(c * RNNOISE_FRAME, (c + 1) * RNNOISE_FRAME);
    const { output, vadProb } = denoiser.processFrame(chunk);
    denoisedWork.set(output, c * RNNOISE_FRAME);
    vadProbSum += vadProb;
  }

  const avgVadProb = numChunks > 0 ? vadProbSum / numChunks : 0;

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
    return { pcm: result, vadProb: avgVadProb };
  }

  return { pcm: denoisedWork, vadProb: avgVadProb };
}
