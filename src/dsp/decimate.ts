/** Hamming-windowed sinc low-pass FIR, DC-normalized to unity gain. */
export function designLowpassFIR(cutoffHz: number, sampleRate: number, numTaps: number): Float64Array {
  const taps = new Float64Array(numTaps);
  const m = numTaps - 1;
  const fc = cutoffHz / sampleRate;
  for (let n = 0; n < numTaps; n++) {
    const k = n - m / 2;
    const sinc = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k);
    const hamming = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / m);
    taps[n] = sinc * hamming;
  }
  let sum = 0;
  for (let n = 0; n < numTaps; n++) sum += taps[n];
  for (let n = 0; n < numTaps; n++) taps[n] /= sum;
  return taps;
}

export function applyFIR(signal: Float64Array, taps: Float64Array): Float64Array {
  const half = Math.floor(taps.length / 2);
  const out = new Float64Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    let acc = 0;
    for (let k = 0; k < taps.length; k++) {
      const idx = i + k - half;
      if (idx >= 0 && idx < signal.length) acc += taps[k] * signal[idx];
    }
    out[i] = acc;
  }
  return out;
}

/** Anti-alias low-pass filter, then keep every `factor`-th sample. */
export function decimate(signal: Float64Array, factor: number, sampleRate: number): Float64Array {
  if (factor <= 1) return signal;
  const effectiveNyquist = sampleRate / factor / 2;
  const taps = designLowpassFIR(effectiveNyquist * 0.9, sampleRate, 31);
  const filtered = applyFIR(signal, taps);
  const outLen = Math.floor(filtered.length / factor);
  const out = new Float64Array(outLen);
  for (let i = 0; i < outLen; i++) out[i] = filtered[i * factor];
  return out;
}
