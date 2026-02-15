// VAD algorithm simulation — replicates AnalyserNode.getByteFrequencyData + VAD logic
// Tests both old (full-band static threshold) and new (speech-weighted adaptive) algorithms

import { fft } from './fft.js';

const MIN_NOISE_FLOOR = 3;

/**
 * Simulate AnalyserNode.getByteFrequencyData() for a chunk of audio.
 * Matches Chrome's implementation: Blackman window → FFT → dB → byte mapping.
 *
 * @param {Float32Array} samples - audio samples (at least fftSize)
 * @param {number} fftSize - FFT size (default 1024)
 * @param {Uint8Array|null} previousSmoothed - previous frame's smoothed dB values (for temporal smoothing)
 * @param {number} smoothingTimeConstant - 0 to 1 (default 0.5, matching useVoice.js)
 * @returns {{ bytes: Uint8Array, smoothedDb: Float64Array }}
 */
export function simulateByteFrequencyData(samples, fftSize = 1024, previousSmoothed = null, smoothingTimeConstant = 0.5) {
  const numBins = fftSize / 2;

  // Blackman window (AnalyserNode default)
  const real = new Float64Array(fftSize);
  const imag = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    const w = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (fftSize - 1))
            + 0.08 * Math.cos(4 * Math.PI * i / (fftSize - 1));
    real[i] = (i < samples.length ? samples[i] : 0) * w;
  }

  fft(real, imag);

  // Magnitude → dB
  const currentDb = new Float64Array(numBins);
  for (let i = 0; i < numBins; i++) {
    const mag = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) / fftSize;
    currentDb[i] = 20 * Math.log10(Math.max(mag, 1e-20));
  }

  // Temporal smoothing
  const smoothedDb = new Float64Array(numBins);
  if (previousSmoothed) {
    for (let i = 0; i < numBins; i++) {
      smoothedDb[i] = smoothingTimeConstant * previousSmoothed[i] + (1 - smoothingTimeConstant) * currentDb[i];
    }
  } else {
    smoothedDb.set(currentDb);
  }

  // Map to bytes (0-255) using AnalyserNode defaults: minDecibels=-100, maxDecibels=-30
  const minDb = -100, maxDb = -30;
  const bytes = new Uint8Array(numBins);
  for (let i = 0; i < numBins; i++) {
    const normalized = (smoothedDb[i] - minDb) / (maxDb - minDb);
    bytes[i] = Math.max(0, Math.min(255, Math.round(normalized * 255)));
  }

  return { bytes, smoothedDb };
}

/**
 * Old VAD algorithm: full-band average vs static threshold.
 * Replicates the original computeThreshold + average-all-bins logic.
 */
export function oldVadDecision(bytes, sensitivity = 50) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) sum += bytes[i];
  const avg = sum / bytes.length;
  const threshold = Math.max(2, Math.round(60 * Math.pow(0.97, sensitivity)));
  return { speaking: avg > threshold, energy: avg, threshold };
}

/**
 * New VAD algorithm: speech-band weighted, adaptive noise floor.
 * Replicates the improved useVoice.js logic.
 */
export class AdaptiveVad {
  constructor(sampleRate = 48000, fftSize = 1024, sensitivity = 50) {
    this.sampleRate = sampleRate;
    this.fftSize = fftSize;
    this.sensitivity = sensitivity;

    const binWidth = sampleRate / fftSize;
    this.speechLowBin = Math.round(200 / binWidth);    // ~200Hz
    this.speechHighBin = Math.floor(3000 / binWidth);   // ~3kHz
    this.speechBinCount = this.speechHighBin - this.speechLowBin + 1;

    this.noiseFloor = 10;
    this.warmupFrames = 5; // First 500ms: minimum tracking to find ambient level
    this.warmupMin = Infinity;
    this.wasSpeaking = false;
    this.lastSpeechTime = -Infinity;
    this.smoothedDb = null;
    this.holdMs = 300;
    this.currentTime = 0;
  }

  /**
   * Process one analysis frame.
   * @param {Float32Array} samples - audio chunk (fftSize samples)
   * @param {number} dtMs - time elapsed since last frame
   * @returns {{ speaking: boolean, gateOpen: boolean, speechEnergy: number, noiseFloor: number, margin: number }}
   */
  process(samples, dtMs = 100) {
    this.currentTime += dtMs;

    const { bytes, smoothedDb } = simulateByteFrequencyData(
      samples, this.fftSize, this.smoothedDb, 0.5
    );
    this.smoothedDb = smoothedDb;

    // Speech-band energy
    let speechEnergy = 0;
    for (let i = this.speechLowBin; i <= this.speechHighBin; i++) {
      speechEnergy += bytes[i];
    }
    speechEnergy /= this.speechBinCount;

    // Update noise floor
    if (this.warmupFrames > 0) {
      // Warmup: minimum tracking — captures ambient level on first frame,
      // ignores speech peaks. No false activations even during calibration.
      this.warmupMin = Math.min(this.warmupMin, speechEnergy);
      this.noiseFloor = Math.max(MIN_NOISE_FLOOR, this.warmupMin);
      this.warmupFrames--;
    } else if (!this.wasSpeaking) {
      // Steady state: slow EMA during silence only
      if (speechEnergy < this.noiseFloor) {
        this.noiseFloor = this.noiseFloor * 0.8 + speechEnergy * 0.2;
      } else {
        this.noiseFloor = this.noiseFloor * 0.97 + speechEnergy * 0.03;
      }
      this.noiseFloor = Math.max(MIN_NOISE_FLOOR, this.noiseFloor);
    }

    const margin = Math.round(3 + 22 * (1 - this.sensitivity / 100));
    const speaking = speechEnergy > this.noiseFloor + margin;

    if (speaking) {
      this.lastSpeechTime = this.currentTime;
    }
    this.wasSpeaking = speaking;

    // Gate open = speaking OR within hold time
    const gateOpen = speaking || (this.currentTime - this.lastSpeechTime <= this.holdMs);

    return { speaking, gateOpen, speechEnergy, noiseFloor: this.noiseFloor, margin };
  }
}

/**
 * Run a VAD algorithm over an entire signal, polling every intervalMs.
 * Returns per-frame decisions and aggregate metrics.
 * @param {number} skipFrames - frames to exclude from aggregate metrics (warmup/calibration)
 */
export function runVadOnSignal(signal, algorithm, sampleRate = 48000, fftSize = 1024, intervalMs = 100, skipFrames = 0) {
  const samplesPerInterval = Math.round(sampleRate * intervalMs / 1000);
  const frames = [];

  for (let offset = 0; offset + fftSize <= signal.length; offset += samplesPerInterval) {
    const chunk = signal.subarray(offset, offset + fftSize);
    const result = algorithm.process(chunk, intervalMs);
    frames.push({
      timeMs: (offset / sampleRate) * 1000,
      ...result,
    });
  }

  // Aggregate metrics (skip warmup/calibration frames)
  const measured = frames.slice(skipFrames);
  const totalFrames = measured.length;
  const gateOpenFrames = measured.filter((f) => f.gateOpen).length;
  const gatePct = totalFrames > 0 ? (gateOpenFrames / totalFrames) * 100 : 0;

  return { frames, totalFrames, gateOpenFrames, gatePct, skippedFrames: skipFrames };
}
