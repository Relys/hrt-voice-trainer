import { ifft } from "./fft.ts";

const DEFAULT_MIN_F0 = 60;
const DEFAULT_MAX_F0 = 500;

/**
 * Cepstral Peak Prominence (Hillenbrand & Houde 1996): the standard acoustic measure of
 * "weight"/breathiness. A periodic (fully voiced) signal's log-magnitude spectrum has strong
 * quasi-periodic ripple, which shows up as a sharp cepstral peak at quefrency 1/F0; a breathy
 * or noisy signal's spectrum is flatter, so the peak barely rises above the surrounding trend.
 * CPP is that peak's height (dB) above a linear regression trend line fit through the same
 * quefrency range — not the raw peak value, which would also just track overall loudness.
 */
export function computeCpp(
  magnitudes: Float64Array,
  fftSize: number,
  sampleRate: number,
  minF0 = DEFAULT_MIN_F0,
  maxF0 = DEFAULT_MAX_F0,
): number {
  const n = fftSize;
  const half = n / 2;

  // Reconstruct the full-length log-magnitude spectrum (Hermitian symmetric) so the
  // inverse FFT below produces a proper real cepstrum rather than a half-spectrum artifact.
  const logMag = new Float64Array(n);
  for (let k = 0; k <= half; k++) {
    const value = 20 * Math.log10(magnitudes[k] + 1e-12);
    logMag[k] = value;
    if (k > 0 && k < half) logMag[n - k] = value;
  }

  const re = Float64Array.from(logMag);
  const im = new Float64Array(n);
  ifft(re, im);
  const cepstrum = re;

  const minQ = Math.max(1, Math.floor(sampleRate / maxF0));
  const maxQ = Math.min(n - 1, Math.ceil(sampleRate / minF0));
  if (maxQ <= minQ) return 0;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  let count = 0;
  let peakQ = minQ;
  let peakValue = -Infinity;
  for (let q = minQ; q <= maxQ; q++) {
    const value = cepstrum[q];
    sumX += q;
    sumY += value;
    sumXY += q * value;
    sumXX += q * q;
    count++;
    if (value > peakValue) {
      peakValue = value;
      peakQ = q;
    }
  }

  const meanX = sumX / count;
  const meanY = sumY / count;
  const denom = sumXX - count * meanX * meanX;
  const slope = denom !== 0 ? (sumXY - count * meanX * meanY) / denom : 0;
  const intercept = meanY - slope * meanX;
  const trendAtPeak = slope * peakQ + intercept;

  return peakValue - trendAtPeak;
}
