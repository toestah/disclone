// Test signal generators — all produce Float32Array at 48kHz, 2 seconds

const SAMPLE_RATE = 48000;
const DURATION = 2;
const NUM_SAMPLES = SAMPLE_RATE * DURATION;

/**
 * Sine sweep from startHz to endHz (linear frequency sweep).
 * Reveals frequency response and filter rolloff.
 */
export function sineSweep(startHz = 100, endHz = 12000) {
  const out = new Float32Array(NUM_SAMPLES);
  for (let i = 0; i < NUM_SAMPLES; i++) {
    const t = i / SAMPLE_RATE;
    const tNorm = t / DURATION;
    // Instantaneous frequency: linear interpolation
    const freq = startHz + (endHz - startHz) * tNorm;
    // Phase integral of linear sweep: 2π * (f0*t + (f1-f0)*t²/(2*T))
    const phase = 2 * Math.PI * (startHz * t + (endHz - startHz) * t * t / (2 * DURATION));
    out[i] = 0.8 * Math.sin(phase);
  }
  return out;
}

/**
 * Pure 1kHz sine wave at 0.8 amplitude.
 * Reveals THD from quantization and processing artifacts.
 */
export function pureSine(hz = 1000) {
  const out = new Float32Array(NUM_SAMPLES);
  for (let i = 0; i < NUM_SAMPLES; i++) {
    out[i] = 0.8 * Math.sin(2 * Math.PI * hz * i / SAMPLE_RATE);
  }
  return out;
}

/**
 * Impulse train — sharp spike every 100ms.
 * Tests transient preservation, buffer smearing.
 */
export function impulseTrain(intervalMs = 100) {
  const out = new Float32Array(NUM_SAMPLES);
  const intervalSamples = Math.round(SAMPLE_RATE * intervalMs / 1000);
  for (let i = 0; i < NUM_SAMPLES; i += intervalSamples) {
    out[i] = 0.9;
  }
  return out;
}

/**
 * White noise at -20dB (amplitude ~0.1).
 * Tests noise floor, any noise added or removed by pipeline.
 */
export function whiteNoise(amplitude = 0.1) {
  const out = new Float32Array(NUM_SAMPLES);
  for (let i = 0; i < NUM_SAMPLES; i++) {
    out[i] = amplitude * (Math.random() * 2 - 1);
  }
  return out;
}

/**
 * Speech-like signal: lead silence for VAD calibration, then alternating bursts/pauses.
 * Uses a fundamental + 7 overtones (150–1200Hz) — realistic speech spectrum.
 * Pattern: 600ms silence → repeating 700ms speech / 100ms silence.
 * The lead silence lets the VAD noise floor calibrate to ambient before speech starts.
 * Tests VAD gate timing, syllable clipping, hold time behavior.
 */
export function speechEnvelope(fundamentalHz = 150, burstMs = 700, silenceMs = 100) {
  const out = new Float32Array(NUM_SAMPLES);
  const harmonicWeights = [1.0, 0.7, 0.5, 0.35, 0.25, 0.18, 0.12, 0.08];
  const normFactor = harmonicWeights.reduce((a, b) => a + b, 0);
  const leadSilenceMs = 600; // VAD warmup calibration period
  const cycleMs = burstMs + silenceMs;
  const rampMs = 10; // 10ms onset/offset ramp to avoid clicks
  for (let i = 0; i < NUM_SAMPLES; i++) {
    const t = i / SAMPLE_RATE;
    const tMs = t * 1000;
    if (tMs < leadSilenceMs) continue; // silence during warmup
    const posInActive = tMs - leadSilenceMs;
    const posInCycle = posInActive % cycleMs;
    if (posInCycle < burstMs) {
      let env = 1;
      if (posInCycle < rampMs) env = posInCycle / rampMs;
      else if (posInCycle > burstMs - rampMs) env = (burstMs - posInCycle) / rampMs;
      let sample = 0;
      for (let h = 0; h < harmonicWeights.length; h++) {
        sample += harmonicWeights[h] * Math.sin(2 * Math.PI * fundamentalHz * (h + 1) * t);
      }
      out[i] = 0.8 * env * sample / normFactor;
    }
  }
  return out;
}

/**
 * Float32 → Int16 PCM (matches useVoice.js encoding: (sample * 32767) | 0, clamped)
 * Returns ArrayBuffer of Int16 values.
 */
export function floatToInt16(f32) {
  const int16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    int16[i] = Math.max(-32768, Math.min(32767, (f32[i] * 32767) | 0));
  }
  return int16.buffer;
}

/**
 * Int16 PCM → Float32 (matches useVoice.js decoding: sample / 32768)
 * Takes ArrayBuffer or Node.js Buffer, returns Float32Array.
 */
export function int16ToFloat(buf) {
  let int16;
  if (buf instanceof ArrayBuffer) {
    int16 = new Int16Array(buf);
  } else if (ArrayBuffer.isView(buf)) {
    // Node.js Buffer uses a shared pool — copy to aligned ArrayBuffer
    const copy = new ArrayBuffer(buf.byteLength);
    new Uint8Array(copy).set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    int16 = new Int16Array(copy);
  } else {
    int16 = new Int16Array(buf);
  }
  const f32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    f32[i] = int16[i] / 32768;
  }
  return f32;
}

// ── Noise / interference signals (for VAD testing) ──────

/**
 * Keyboard click pattern — broadband 3-5ms impulses at irregular intervals.
 * Should be REJECTED by VAD (no sustained speech-band energy).
 */
export function keyboardClicks(clicksPerSecond = 7, amplitude = 0.15) {
  const out = new Float32Array(NUM_SAMPLES);
  const avgInterval = SAMPLE_RATE / clicksPerSecond;
  let pos = Math.round(avgInterval * Math.random());

  while (pos < NUM_SAMPLES) {
    // Each click: 3-5ms burst of shaped noise (half-sine envelope)
    const clickLen = Math.round(SAMPLE_RATE * (0.003 + Math.random() * 0.002));
    for (let i = 0; i < clickLen && pos + i < NUM_SAMPLES; i++) {
      const env = Math.sin(Math.PI * i / clickLen);
      out[pos + i] = amplitude * env * (Math.random() * 2 - 1);
    }
    pos += Math.round(avgInterval * (0.5 + Math.random()));
  }
  return out;
}

/**
 * Chair/desk noise — low-frequency broadband rumble bursts (20-200Hz).
 * Should be REJECTED by VAD (energy below speech band).
 */
export function chairNoise(amplitude = 0.08) {
  const out = new Float32Array(NUM_SAMPLES);
  // 3-4 bursts of 200-400ms over the 2-second signal
  const burstCount = 3 + Math.floor(Math.random() * 2);
  for (let b = 0; b < burstCount; b++) {
    const start = Math.round((b / burstCount) * NUM_SAMPLES * 0.8 + Math.random() * SAMPLE_RATE * 0.3);
    const duration = Math.round(SAMPLE_RATE * (0.2 + Math.random() * 0.2));
    // Sum of random low-frequency sines
    const freqs = [];
    for (let f = 20; f <= 200; f += 15 + Math.random() * 10) freqs.push(f);
    const phases = freqs.map(() => Math.random() * 2 * Math.PI);
    for (let i = 0; i < duration && start + i < NUM_SAMPLES; i++) {
      const env = Math.sin(Math.PI * i / duration); // smooth envelope
      let sample = 0;
      for (let f = 0; f < freqs.length; f++) {
        sample += Math.sin(2 * Math.PI * freqs[f] * (start + i) / SAMPLE_RATE + phases[f]);
      }
      out[start + i] = amplitude * env * sample / freqs.length;
    }
  }
  return out;
}

/**
 * Constant fan/AC noise — shaped broadband noise (mostly < 500Hz).
 * Should be REJECTED by VAD (constant level, adaptive noise floor adapts during warmup).
 */
export function fanNoise(amplitude = 0.015) {
  const out = new Float32Array(NUM_SAMPLES);
  // Pink-ish noise via cascaded IIR lowpass (steeper rolloff, cuts above ~500Hz)
  let state1 = 0, state2 = 0;
  const alpha = 0.06; // ~460Hz cutoff at 48kHz
  for (let i = 0; i < NUM_SAMPLES; i++) {
    const white = Math.random() * 2 - 1;
    state1 = state1 * (1 - alpha) + white * alpha;
    state2 = state2 * (1 - alpha) + state1 * alpha;
    out[i] = amplitude * state2 / (alpha * alpha);
  }
  return out;
}

/**
 * Speech envelope with keyboard clicks in the background.
 * VAD should detect speech portions and reject click-only portions.
 */
export function speechWithClicks() {
  const speech = speechEnvelope();
  const clicks = keyboardClicks(7, 0.12);
  const out = new Float32Array(NUM_SAMPLES);
  for (let i = 0; i < NUM_SAMPLES; i++) out[i] = speech[i] + clicks[i];
  return out;
}

/**
 * Speech envelope with constant fan noise.
 * VAD should detect speech, noise floor should adapt to fan baseline.
 */
export function speechWithFan() {
  const speech = speechEnvelope();
  const fan = fanNoise(0.02);
  const out = new Float32Array(NUM_SAMPLES);
  for (let i = 0; i < NUM_SAMPLES; i++) out[i] = speech[i] + fan[i];
  return out;
}

/** Fidelity test signals (sent through server relay) */
export const ALL_SIGNALS = {
  sweep: sineSweep,
  sine: pureSine,
  impulse: impulseTrain,
  noise: whiteNoise,
  speech: speechEnvelope,
};

/** VAD test signals (for gate behavior analysis) */
export const VAD_SIGNALS = {
  speech: { gen: speechEnvelope, expectGate: 'open', desc: 'Speech — should trigger gate' },
  keyboard: { gen: keyboardClicks, expectGate: 'closed', desc: 'Keyboard clicks — should NOT trigger gate' },
  chair: { gen: chairNoise, expectGate: 'closed', desc: 'Chair/desk noise — should NOT trigger gate' },
  fan: { gen: fanNoise, expectGate: 'closed', desc: 'Fan/AC noise — should NOT trigger gate' },
  speechClicks: { gen: speechWithClicks, expectGate: 'partial', desc: 'Speech + keyboard — gate open during speech only' },
  speechFan: { gen: speechWithFan, expectGate: 'partial', desc: 'Speech + fan — gate open during speech only' },
};

export { SAMPLE_RATE, DURATION, NUM_SAMPLES };
