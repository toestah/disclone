// Audio quality metrics — SNR, THD, latency, dropouts, spectral diff, packet stats

import { fft, averageSpectrum, crossCorrelationLag } from './fft.js';

/**
 * Signal-to-Noise Ratio (dB).
 * Aligns input/output via cross-correlation, then computes SNR.
 */
export function snr(input, output) {
  // Align signals
  const lag = crossCorrelationLag(output, input);
  const alignedOutput = output.slice(lag);
  const len = Math.min(input.length, alignedOutput.length);

  let signalPower = 0;
  let noisePower = 0;
  for (let i = 0; i < len; i++) {
    signalPower += input[i] * input[i];
    const diff = input[i] - alignedOutput[i];
    noisePower += diff * diff;
  }

  if (noisePower === 0) return Infinity;
  return 10 * Math.log10(signalPower / noisePower);
}

/**
 * Total Harmonic Distortion (%).
 * Uses FFT to measure harmonic power vs fundamental.
 */
export function thd(signal, fundamentalHz = 1000, sampleRate = 48000) {
  const fftSize = 4096;
  const binWidth = sampleRate / fftSize;
  const fundBin = Math.round(fundamentalHz / binWidth);

  // Window and FFT
  const real = new Float64Array(fftSize);
  const imag = new Float64Array(fftSize);
  const window = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fftSize - 1)));
  }

  // Use middle section of signal for best stability
  const startOffset = Math.max(0, Math.floor((signal.length - fftSize) / 2));
  const len = Math.min(signal.length - startOffset, fftSize);
  for (let i = 0; i < len; i++) {
    real[i] = signal[startOffset + i] * window[i];
  }

  fft(real, imag);

  // Measure power at fundamental and harmonics (2x through 5x)
  function binPower(bin) {
    // Sum power in a ±2 bin window to account for spectral leakage
    let power = 0;
    for (let b = Math.max(0, bin - 2); b <= Math.min(fftSize / 2, bin + 2); b++) {
      power += real[b] * real[b] + imag[b] * imag[b];
    }
    return power;
  }

  const fundamentalPower = binPower(fundBin);
  let harmonicPower = 0;
  for (let h = 2; h <= 5; h++) {
    const harmonicBin = fundBin * h;
    if (harmonicBin < fftSize / 2) {
      harmonicPower += binPower(harmonicBin);
    }
  }

  if (fundamentalPower === 0) return 100;
  return 100 * Math.sqrt(harmonicPower / fundamentalPower);
}

/**
 * Latency in milliseconds via FFT-based cross-correlation.
 */
export function latency(input, output, sampleRate = 48000) {
  const lag = crossCorrelationLag(output, input);
  return (lag / sampleRate) * 1000;
}

/**
 * Detect dropouts: runs of |sample| < threshold in output that are NOT silent in input.
 * If reference (input signal) is provided, only flags dropouts where input had energy.
 * Returns array of { startSample, endSample, durationMs }.
 */
export function dropouts(signal, sampleRate = 48000, threshold = 0.0001, minDurationMs = 1, reference = null) {
  const minSamples = Math.ceil(sampleRate * minDurationMs / 1000);
  const results = [];
  let runStart = -1;

  // Skip leading silence (first 10ms) and trailing silence (last 10ms)
  const skipSamples = Math.ceil(sampleRate * 0.01);
  const startIdx = skipSamples;
  const endIdx = signal.length - skipSamples;

  for (let i = startIdx; i < endIdx; i++) {
    if (Math.abs(signal[i]) < threshold) {
      if (runStart === -1) runStart = i;
    } else {
      if (runStart !== -1) {
        const runLen = i - runStart;
        if (runLen >= minSamples) {
          // Check if input had energy during this dropout
          let inputHadEnergy = true;
          if (reference) {
            let refEnergy = 0;
            const refEnd = Math.min(i, reference.length);
            for (let j = runStart; j < refEnd; j++) {
              refEnergy += Math.abs(reference[j]);
            }
            // If input was also silent, this isn't a dropout
            inputHadEnergy = refEnergy / runLen > threshold * 10;
          }
          if (inputHadEnergy) {
            results.push({
              startSample: runStart,
              endSample: i - 1,
              durationMs: (runLen / sampleRate) * 1000,
            });
          }
        }
        runStart = -1;
      }
    }
  }

  // Check trailing run
  if (runStart !== -1) {
    const runLen = endIdx - runStart;
    if (runLen >= minSamples) {
      let inputHadEnergy = true;
      if (reference) {
        let refEnergy = 0;
        const refEnd = Math.min(endIdx, reference.length);
        for (let j = runStart; j < refEnd; j++) {
          refEnergy += Math.abs(reference[j]);
        }
        inputHadEnergy = refEnergy / runLen > threshold * 10;
      }
      if (inputHadEnergy) {
        results.push({
          startSample: runStart,
          endSample: endIdx - 1,
          durationMs: (runLen / sampleRate) * 1000,
        });
      }
    }
  }

  return results;
}

/**
 * Per-bin spectral difference between input and output.
 * Returns { freqs, inputDb, outputDb, diffDb } arrays.
 */
export function spectralDiff(input, output, fftSize = 1024, hopSize = 512, sampleRate = 48000) {
  const inSpec = averageSpectrum(input, fftSize, hopSize, sampleRate);
  const outSpec = averageSpectrum(output, fftSize, hopSize, sampleRate);

  const numBins = inSpec.bins.length;
  const diffDb = new Float64Array(numBins);
  for (let i = 0; i < numBins; i++) {
    diffDb[i] = outSpec.bins[i] - inSpec.bins[i];
  }

  return {
    freqs: Array.from(inSpec.freqs),
    inputDb: Array.from(inSpec.bins),
    outputDb: Array.from(outSpec.bins),
    diffDb: Array.from(diffDb),
  };
}

/**
 * Packet delivery statistics from sequence numbers.
 * @param {number[]} receivedSeqs - sequence numbers received (in order received)
 * @param {number} expectedCount - total frames sent
 */
export function packetStats(receivedSeqs, expectedCount) {
  const received = receivedSeqs.length;
  const deliveryPct = (received / expectedCount) * 100;

  // Out-of-order count
  let outOfOrder = 0;
  for (let i = 1; i < receivedSeqs.length; i++) {
    if (receivedSeqs[i] < receivedSeqs[i - 1]) outOfOrder++;
  }

  // Duplicates
  const unique = new Set(receivedSeqs);
  const duplicates = received - unique.size;

  // Max gap
  const sorted = [...unique].sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1] - 1;
    if (gap > maxGap) maxGap = gap;
  }

  return {
    sent: expectedCount,
    received,
    deliveryPct: Math.round(deliveryPct * 100) / 100,
    outOfOrder,
    duplicates,
    maxGap,
  };
}
