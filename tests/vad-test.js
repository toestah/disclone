// VAD behavior test — verifies gate behavior for speech, noise, and mixed signals
// Compares old (full-band static) vs new (speech-weighted adaptive) algorithms

import { writeFileSync, mkdirSync } from 'fs';
import { VAD_SIGNALS, SAMPLE_RATE } from './lib/signals.js';
import { AdaptiveVad, runVadOnSignal, simulateByteFrequencyData } from './lib/vad.js';

const FFT_SIZE = 1024;
const INTERVAL_MS = 100;

/**
 * Old VAD: full-band average with static threshold.
 * Wrapped in the same interface as AdaptiveVad for comparison.
 */
class OldVad {
  constructor(sampleRate = 48000, fftSize = 1024, sensitivity = 50) {
    this.fftSize = fftSize;
    this.sensitivity = sensitivity;
    this.smoothedDb = null;
    this.lastSpeechTime = -Infinity;
    this.currentTime = 0;
    this.holdMs = 300;
  }

  process(samples, dtMs = 100) {
    this.currentTime += dtMs;
    const { bytes, smoothedDb } = simulateByteFrequencyData(
      samples, this.fftSize, this.smoothedDb, 0.5
    );
    this.smoothedDb = smoothedDb;

    let sum = 0;
    for (let i = 0; i < bytes.length; i++) sum += bytes[i];
    const energy = sum / bytes.length;
    const threshold = Math.max(2, Math.round(60 * Math.pow(0.97, this.sensitivity)));
    const speaking = energy > threshold;

    if (speaking) this.lastSpeechTime = this.currentTime;
    const gateOpen = speaking || (this.currentTime - this.lastSpeechTime <= this.holdMs);

    return { speaking, gateOpen, speechEnergy: energy, noiseFloor: 0, margin: threshold };
  }
}

/**
 * For "partial" signals (speech + noise), compute precision metrics.
 * Speech uses: 600ms lead silence, then repeating 600ms burst / 200ms silence.
 * Active when within the burst portion of the cycle (after lead silence).
 */
function speechActiveMap(signal, sampleRate, intervalMs) {
  const samplesPerInterval = Math.round(sampleRate * intervalMs / 1000);
  const leadSilenceMs = 600, burstMs = 700, silenceMs = 100;
  const cycleMs = burstMs + silenceMs;
  const map = [];
  for (let offset = 0; offset + 1024 <= signal.length; offset += samplesPerInterval) {
    const tMs = (offset / sampleRate) * 1000;
    if (tMs < leadSilenceMs) {
      map.push(false); // lead silence = no speech
    } else {
      const posInActive = tMs - leadSilenceMs;
      const posInCycle = posInActive % cycleMs;
      map.push(posInCycle < burstMs);
    }
  }
  return map;
}

/**
 * Run VAD test for all signal types with both algorithms.
 * @param {string} resultsDir - directory to write output
 * @returns {Object} results
 */
export function runVadTest(resultsDir) {
  mkdirSync(resultsDir, { recursive: true });

  const results = {};

  for (const [name, { gen, expectGate, desc }] of Object.entries(VAD_SIGNALS)) {
    console.log(`[VAD] Testing: ${name} — ${desc}`);
    const signal = gen();

    // Run old algorithm (skip 5 warmup frames for fair comparison)
    const SKIP = 5;
    const oldVad = new OldVad(SAMPLE_RATE, FFT_SIZE, 50);
    const oldResult = runVadOnSignal(signal, oldVad, SAMPLE_RATE, FFT_SIZE, INTERVAL_MS, SKIP);

    // Run new algorithm (skip 5 warmup frames — calibration period)
    const newVad = new AdaptiveVad(SAMPLE_RATE, FFT_SIZE, 50);
    const newResult = runVadOnSignal(signal, newVad, SAMPLE_RATE, FFT_SIZE, INTERVAL_MS, SKIP);

    // Compute metrics based on expected behavior
    let oldScore, newScore;

    if (expectGate === 'closed') {
      // Noise-only: gate should stay CLOSED. Lower gatePct = better.
      oldScore = { falseActivationPct: oldResult.gatePct };
      newScore = { falseActivationPct: newResult.gatePct };
    } else if (expectGate === 'open') {
      // Speech-only: gate should be OPEN. Higher gatePct = better.
      oldScore = { detectionPct: oldResult.gatePct };
      newScore = { detectionPct: newResult.gatePct };
    } else {
      // Partial (speech + noise): measure precision during speech vs silence (post-warmup only)
      const speechMap = speechActiveMap(signal, SAMPLE_RATE, INTERVAL_MS);
      const allOldFrames = runVadOnSignal(signal, new OldVad(SAMPLE_RATE, FFT_SIZE, 50), SAMPLE_RATE, FFT_SIZE, INTERVAL_MS, 0).frames;
      const allNewFrames = runVadOnSignal(signal, new AdaptiveVad(SAMPLE_RATE, FFT_SIZE, 50), SAMPLE_RATE, FFT_SIZE, INTERVAL_MS, 0).frames;
      const len = Math.min(speechMap.length, allOldFrames.length, allNewFrames.length);

      let oldTP = 0, oldFP = 0, oldTN = 0, oldFN = 0;
      let newTP = 0, newFP = 0, newTN = 0, newFN = 0;

      for (let i = SKIP; i < len; i++) {
        const active = speechMap[i];
        if (active && allOldFrames[i].gateOpen) oldTP++;
        if (active && !allOldFrames[i].gateOpen) oldFN++;
        if (!active && allOldFrames[i].gateOpen) oldFP++;
        if (!active && !allOldFrames[i].gateOpen) oldTN++;

        if (active && allNewFrames[i].gateOpen) newTP++;
        if (active && !allNewFrames[i].gateOpen) newFN++;
        if (!active && allNewFrames[i].gateOpen) newFP++;
        if (!active && !allNewFrames[i].gateOpen) newTN++;
      }

      oldScore = {
        truePositiveRate: len > 0 ? Math.round(oldTP / Math.max(1, oldTP + oldFN) * 10000) / 100 : 0,
        falsePositiveRate: len > 0 ? Math.round(oldFP / Math.max(1, oldFP + oldTN) * 10000) / 100 : 0,
      };
      newScore = {
        truePositiveRate: len > 0 ? Math.round(newTP / Math.max(1, newTP + newFN) * 10000) / 100 : 0,
        falsePositiveRate: len > 0 ? Math.round(newFP / Math.max(1, newFP + newTN) * 10000) / 100 : 0,
      };
    }

    results[name] = {
      desc,
      expectGate,
      old: { gatePct: Math.round(oldResult.gatePct * 100) / 100, ...oldScore },
      new: { gatePct: Math.round(newResult.gatePct * 100) / 100, ...newScore },
    };

    console.log(`[VAD]   old: gate open ${oldResult.gatePct.toFixed(1)}% | new: gate open ${newResult.gatePct.toFixed(1)}%`);
  }

  writeFileSync(`${resultsDir}/vad-test.json`, JSON.stringify(results, null, 2));
  console.log(`[VAD] Results written to ${resultsDir}/vad-test.json`);
  return results;
}

// Run directly
if (process.argv[1]?.endsWith('vad-test.js')) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultsDir = new URL(`./results/run-${timestamp}`, import.meta.url).pathname;

  const results = runVadTest(resultsDir);
  console.log('\n[VAD] Results:', JSON.stringify(results, null, 2));
}
