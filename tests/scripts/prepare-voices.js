#!/usr/bin/env node

// Generate synthetic voice test fixtures at 48kHz
// Produces realistic speech-like signals with formant structure, prosody, and natural envelope
// Output: Float32 raw files (.f32), normalized to -3dBFS

import { writeFileSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '../fixtures/voices');
const SAMPLE_RATE = 48000;
const TARGET_DB = -3; // normalize to -3dBFS
const TARGET_AMP = Math.pow(10, TARGET_DB / 20);

/**
 * Generate a realistic speech-like signal with:
 * - Fundamental + harmonics with natural rolloff
 * - Formant-like resonances (3 formants)
 * - Syllable-like amplitude envelope with prosody variation
 * - Breathy noise component
 */
function generateVoice(fundamentalHz, durationSec, formantShifts = [1, 1, 1]) {
  const numSamples = Math.round(SAMPLE_RATE * durationSec);
  const out = new Float32Array(numSamples);

  // Formant frequencies (Hz) — typical speech formants, shifted for variety
  const F1 = 500 * formantShifts[0];   // first formant
  const F2 = 1500 * formantShifts[1];  // second formant
  const F3 = 2500 * formantShifts[2];  // third formant
  const formantBW = [100, 120, 150];   // bandwidths

  // Harmonic weights with natural spectral tilt (~-12dB/octave)
  const numHarmonics = Math.min(12, Math.floor(8000 / fundamentalHz));
  const harmonicWeights = [];
  for (let h = 1; h <= numHarmonics; h++) {
    const freq = fundamentalHz * h;
    // Base weight: -12dB/octave tilt
    let weight = 1.0 / (h * h);
    // Apply formant resonances (simplified Gaussian bumps)
    const formants = [F1, F2, F3];
    for (let f = 0; f < 3; f++) {
      const dist = (freq - formants[f]) / formantBW[f];
      weight *= 1 + 2 * Math.exp(-0.5 * dist * dist);
    }
    harmonicWeights.push(weight);
  }

  // Normalize harmonic weights
  const maxWeight = Math.max(...harmonicWeights);
  for (let i = 0; i < harmonicWeights.length; i++) {
    harmonicWeights[i] /= maxWeight;
  }

  // Syllable envelope: 500ms lead silence, then alternating speech/pause
  // Varied syllable lengths for natural prosody
  const leadSilenceMs = 500;
  const syllables = [];
  let t = leadSilenceMs;
  while (t < durationSec * 1000 - 100) {
    const burstMs = 150 + Math.random() * 400;  // 150-550ms syllables
    const pauseMs = 30 + Math.random() * 120;   // 30-150ms pauses
    syllables.push({ start: t, end: t + burstMs });
    t += burstMs + pauseMs;
  }

  // Slight F0 variation (jitter + drift) for naturalness
  const f0Drift = 0.03 + Math.random() * 0.04; // 3-7% drift
  let phase = 0;

  for (let i = 0; i < numSamples; i++) {
    const tMs = (i / SAMPLE_RATE) * 1000;

    // Envelope
    let env = 0;
    for (const syl of syllables) {
      if (tMs >= syl.start && tMs <= syl.end) {
        const posInSyl = tMs - syl.start;
        const sylLen = syl.end - syl.start;
        const rampMs = 15;
        if (posInSyl < rampMs) {
          env = posInSyl / rampMs;
        } else if (posInSyl > sylLen - rampMs) {
          env = (sylLen - posInSyl) / rampMs;
        } else {
          env = 1;
        }
        // Slight amplitude variation within syllable
        env *= 0.85 + 0.15 * Math.sin(2 * Math.PI * 4 * tMs / 1000);
        break;
      }
    }

    if (env < 0.001) continue;

    // F0 with natural jitter and slow drift
    const f0 = fundamentalHz * (1 + f0Drift * Math.sin(2 * Math.PI * 3.5 * i / SAMPLE_RATE)
      + 0.005 * (Math.random() * 2 - 1)); // micro-jitter

    // Sum harmonics
    let sample = 0;
    const dt = 1 / SAMPLE_RATE;
    phase += 2 * Math.PI * f0 * dt;
    if (phase > 2 * Math.PI) phase -= 2 * Math.PI;

    for (let h = 0; h < harmonicWeights.length; h++) {
      sample += harmonicWeights[h] * Math.sin(phase * (h + 1));
    }

    // Add breathy noise component (aspiration)
    const breathNoise = (Math.random() * 2 - 1) * 0.08;
    sample += breathNoise;

    out[i] = env * sample;
  }

  return out;
}

/**
 * Normalize signal to target dBFS.
 */
function normalize(signal, targetAmp) {
  let peak = 0;
  for (let i = 0; i < signal.length; i++) {
    const abs = Math.abs(signal[i]);
    if (abs > peak) peak = abs;
  }
  if (peak === 0) return signal;
  const gain = targetAmp / peak;
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    out[i] = signal[i] * gain;
  }
  return out;
}

// ── Main ──

const manifest = JSON.parse(readFileSync(resolve(FIXTURES_DIR, 'manifest.json'), 'utf-8'));

console.log(`[Prepare] Generating ${manifest.clips.length} voice fixtures at ${SAMPLE_RATE}Hz...`);

for (const clip of manifest.clips) {
  const formantShifts = clip.accent === 'varied'
    ? [0.9 + Math.random() * 0.3, 0.85 + Math.random() * 0.35, 0.9 + Math.random() * 0.25]
    : [1, 1, 1];

  console.log(`[Prepare]   ${clip.id}: ${clip.fundamental}Hz, ${clip.duration}s, formants=[${formantShifts.map(f => f.toFixed(2)).join(', ')}]`);

  const raw = generateVoice(clip.fundamental, clip.duration, formantShifts);
  const normalized = normalize(raw, TARGET_AMP);

  const outPath = resolve(FIXTURES_DIR, clip.file);
  writeFileSync(outPath, Buffer.from(normalized.buffer));

  // Verify
  let peak = 0;
  for (let i = 0; i < normalized.length; i++) {
    const abs = Math.abs(normalized[i]);
    if (abs > peak) peak = abs;
  }
  const peakDb = 20 * Math.log10(peak);
  console.log(`[Prepare]     → ${normalized.length} samples, peak=${peakDb.toFixed(1)}dBFS`);
}

console.log('[Prepare] Done. Fixtures written to tests/fixtures/voices/');
