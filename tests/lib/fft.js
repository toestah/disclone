// Pure JS radix-2 Cooley-Tukey FFT with Hann windowing

/**
 * In-place radix-2 FFT.
 * @param {Float64Array} real - real parts (length must be power of 2)
 * @param {Float64Array} imag - imaginary parts (same length)
 * @param {boolean} inverse - true for inverse FFT
 */
export function fft(real, imag, inverse = false) {
  const N = real.length;
  if (N & (N - 1)) throw new Error(`FFT size must be power of 2, got ${N}`);

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  // Cooley-Tukey butterfly
  const sign = inverse ? 1 : -1;
  for (let size = 2; size <= N; size *= 2) {
    const halfSize = size / 2;
    const angle = sign * 2 * Math.PI / size;
    const wReal = Math.cos(angle);
    const wImag = Math.sin(angle);

    for (let i = 0; i < N; i += size) {
      let curReal = 1, curImag = 0;
      for (let j = 0; j < halfSize; j++) {
        const evenIdx = i + j;
        const oddIdx = i + j + halfSize;

        const tReal = curReal * real[oddIdx] - curImag * imag[oddIdx];
        const tImag = curReal * imag[oddIdx] + curImag * real[oddIdx];

        real[oddIdx] = real[evenIdx] - tReal;
        imag[oddIdx] = imag[evenIdx] - tImag;
        real[evenIdx] += tReal;
        imag[evenIdx] += tImag;

        const newCurReal = curReal * wReal - curImag * wImag;
        curImag = curReal * wImag + curImag * wReal;
        curReal = newCurReal;
      }
    }
  }

  // Scale for inverse
  if (inverse) {
    for (let i = 0; i < N; i++) {
      real[i] /= N;
      imag[i] /= N;
    }
  }
}

/**
 * Inverse FFT (convenience wrapper).
 */
export function ifft(real, imag) {
  fft(real, imag, true);
}

/**
 * Hann window of length N.
 */
function hannWindow(N) {
  const w = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
  }
  return w;
}

/**
 * Compute magnitude spectrum in dB for a single window of signal data.
 * Returns positive-frequency bins only (fftSize/2 + 1 values).
 */
export function magnitudeSpectrum(signal, fftSize = 1024) {
  const window = hannWindow(fftSize);
  const real = new Float64Array(fftSize);
  const imag = new Float64Array(fftSize);

  const len = Math.min(signal.length, fftSize);
  for (let i = 0; i < len; i++) {
    real[i] = signal[i] * window[i];
  }

  fft(real, imag);

  const numBins = fftSize / 2 + 1;
  const mag = new Float64Array(numBins);
  for (let i = 0; i < numBins; i++) {
    const power = real[i] * real[i] + imag[i] * imag[i];
    mag[i] = 10 * Math.log10(Math.max(power, 1e-20));
  }
  return mag;
}

/**
 * Average spectrum over overlapping windows.
 * Returns { bins: Float64Array (dB), freqs: Float64Array (Hz) }
 */
export function averageSpectrum(signal, fftSize = 1024, hopSize = 512, sampleRate = 48000) {
  const window = hannWindow(fftSize);
  const numBins = fftSize / 2 + 1;
  const avgPower = new Float64Array(numBins);
  let windowCount = 0;

  for (let offset = 0; offset + fftSize <= signal.length; offset += hopSize) {
    const real = new Float64Array(fftSize);
    const imag = new Float64Array(fftSize);

    for (let i = 0; i < fftSize; i++) {
      real[i] = signal[offset + i] * window[i];
    }

    fft(real, imag);

    for (let i = 0; i < numBins; i++) {
      avgPower[i] += real[i] * real[i] + imag[i] * imag[i];
    }
    windowCount++;
  }

  const bins = new Float64Array(numBins);
  for (let i = 0; i < numBins; i++) {
    bins[i] = 10 * Math.log10(Math.max(avgPower[i] / windowCount, 1e-20));
  }

  const freqs = new Float64Array(numBins);
  for (let i = 0; i < numBins; i++) {
    freqs[i] = i * sampleRate / fftSize;
  }

  return { bins, freqs };
}

/**
 * FFT-based cross-correlation between two signals.
 * Returns the lag (in samples) of the peak correlation.
 */
export function crossCorrelationLag(a, b) {
  // Pad to next power of 2 >= a.length + b.length
  const minLen = a.length + b.length;
  let N = 1;
  while (N < minLen) N *= 2;

  const aReal = new Float64Array(N);
  const aImag = new Float64Array(N);
  const bReal = new Float64Array(N);
  const bImag = new Float64Array(N);

  for (let i = 0; i < a.length; i++) aReal[i] = a[i];
  for (let i = 0; i < b.length; i++) bReal[i] = b[i];

  // FFT both
  fft(aReal, aImag);
  fft(bReal, bImag);

  // Multiply A * conj(B)
  const cReal = new Float64Array(N);
  const cImag = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    cReal[i] = aReal[i] * bReal[i] + aImag[i] * bImag[i];
    cImag[i] = aImag[i] * bReal[i] - aReal[i] * bImag[i];
  }

  // Inverse FFT
  ifft(cReal, cImag);

  // Find peak in [0, a.length) — positive lags only
  let maxVal = -Infinity;
  let maxLag = 0;
  const searchLen = Math.min(a.length, N);
  for (let i = 0; i < searchLen; i++) {
    if (cReal[i] > maxVal) {
      maxVal = cReal[i];
      maxLag = i;
    }
  }

  return maxLag;
}

/**
 * Next power of 2 >= n.
 */
export function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}
