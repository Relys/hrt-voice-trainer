import { fft, ifft, nextPowerOfTwo } from "./fft.ts";

export interface PitchEstimate {
  frequency: number;
  /** 0..1, higher = more periodic. This is also a strong voicing/noise discriminator. */
  clarity: number;
}

const DEFAULT_MIN_FREQ = 65;
const DEFAULT_MAX_FREQ = 1000;
/** YIN's "absolute threshold" step (de Cheveigne & Kawahara 2002, section II.D). */
const ABSOLUTE_THRESHOLD = 0.15;

/** First tau where d' dips below `threshold`, walked forward to that dip's local minimum. */
function absoluteThreshold(dPrime: Float64Array, minTau: number, maxTau: number, threshold: number): number | null {
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (dPrime[tau] < threshold) {
      while (tau + 1 <= maxTau && dPrime[tau + 1] < dPrime[tau]) tau++;
      return tau;
    }
  }
  return null;
}

function argmin(dPrime: Float64Array, minTau: number, maxTau: number): number {
  let bestTau = minTau;
  let bestValue = Infinity;
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (dPrime[tau] < bestValue) {
      bestValue = dPrime[tau];
      bestTau = tau;
    }
  }
  return bestTau;
}

/**
 * YIN pitch detection (de Cheveigne & Kawahara 2002), with the difference function
 * computed via FFT-based autocorrelation rather than the naive O(window * maxLag)
 * double loop — same result, a couple of FFTs instead of ~10^6 ops per frame.
 */
export function estimatePitch(
  frame: Float64Array,
  sampleRate: number,
  minFreq = DEFAULT_MIN_FREQ,
  maxFreq = DEFAULT_MAX_FREQ,
): PitchEstimate | null {
  const w = frame.length;
  const minTau = Math.max(1, Math.floor(sampleRate / maxFreq));
  // Need at least two periods of the lowest detectable frequency within the window;
  // if the window's too short for `minFreq`, degrade the effective floor instead of failing.
  const maxTau = Math.min(Math.floor(sampleRate / minFreq), Math.floor(w / 2));
  if (maxTau <= minTau + 2) return null;

  // Autocorrelation via zero-padded FFT (Wiener-Khinchin): pad to >= 2w so the
  // circular autocorrelation matches the linear one for every tau in [0, w-1].
  const n = nextPowerOfTwo(2 * w);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(frame);
  fft(re, im);
  for (let i = 0; i < n; i++) {
    const power = re[i] * re[i] + im[i] * im[i];
    re[i] = power;
    im[i] = 0;
  }
  ifft(re, im);
  const acf = re;

  const cumsum = new Float64Array(w + 1);
  for (let i = 0; i < w; i++) cumsum[i + 1] = cumsum[i] + frame[i] * frame[i];

  const d = new Float64Array(maxTau + 1);
  for (let tau = 0; tau <= maxTau; tau++) {
    const e1 = cumsum[w - tau];
    const e2 = cumsum[w] - cumsum[tau];
    d[tau] = e1 + e2 - 2 * acf[tau];
  }

  const dPrime = new Float64Array(maxTau + 1);
  dPrime[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    runningSum += d[tau];
    dPrime[tau] = runningSum > 0 ? (d[tau] * tau) / runningSum : 1;
  }

  // Prefer the first dip below threshold (smallest period = correct octave); a pure or
  // harmonic-rich tone dips near-zero at every integer multiple of the true period too,
  // so taking the global minimum instead would frequently lock onto a sub-octave.
  const thresholdTau = absoluteThreshold(dPrime, minTau, maxTau, ABSOLUTE_THRESHOLD);
  const bestTau = thresholdTau ?? argmin(dPrime, minTau, maxTau);
  const bestValue = dPrime[bestTau];

  let refinedTau = bestTau;
  if (bestTau > minTau && bestTau < maxTau) {
    const y0 = dPrime[bestTau - 1];
    const y1 = dPrime[bestTau];
    const y2 = dPrime[bestTau + 1];
    const a = (y0 - 2 * y1 + y2) / 2;
    const b = (y2 - y0) / 2;
    if (a !== 0) {
      const delta = Math.max(-1, Math.min(1, -b / (2 * a)));
      refinedTau = bestTau + delta;
    }
  }

  const frequency = sampleRate / refinedTau;
  const clarity = Math.max(0, Math.min(1, 1 - bestValue));
  return { frequency, clarity };
}
