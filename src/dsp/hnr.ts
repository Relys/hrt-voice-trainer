import { fft, ifft, nextPowerOfTwo } from "./fft.ts";
import { applyWindow, hannWindow } from "./window.ts";

const DEFAULT_MIN_F0 = 65;
const DEFAULT_MAX_F0 = 1000;
const MIN_RATIO = 1e-4;
const MAX_RATIO = 0.9999;

/**
 * Harmonic-to-Noise Ratio (dB), via the standard autocorrelation formula
 * HNR = 10*log10(r / (1-r)), where r is the peak normalized autocorrelation within the
 * plausible pitch-period lag range. A clean, periodic voice has strong self-similarity at its
 * true period (r close to 1, high HNR); breathy/noisy phonation has little (r close to 0).
 * Reuses the same FFT-based autocorrelation approach as yin.ts and cpp.ts.
 */
export function computeHnr(
  frame: Float64Array,
  sampleRate: number,
  minF0 = DEFAULT_MIN_F0,
  maxF0 = DEFAULT_MAX_F0,
): number {
  const w = frame.length;
  const minTau = Math.max(1, Math.floor(sampleRate / maxF0));
  const maxTau = Math.min(w - 1, Math.floor(sampleRate / minF0));
  if (maxTau <= minTau) return 10 * Math.log10(MIN_RATIO / (1 - MIN_RATIO));

  // Windowing tapers the frame edges so the discontinuity there doesn't leak broadband
  // "noise-like" energy into the autocorrelation and understate the true periodicity.
  const windowed = applyWindow(frame, hannWindow(w));

  const n = nextPowerOfTwo(2 * w);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(windowed);
  fft(re, im);
  for (let i = 0; i < n; i++) {
    const power = re[i] * re[i] + im[i] * im[i];
    re[i] = power;
    im[i] = 0;
  }
  ifft(re, im);
  const acf = re;
  const r0 = acf[0];
  if (r0 <= 0) return 10 * Math.log10(MIN_RATIO / (1 - MIN_RATIO));

  let peak = 0;
  for (let tau = minTau; tau <= maxTau; tau++) {
    const normalized = acf[tau] / r0;
    if (normalized > peak) peak = normalized;
  }

  const clamped = Math.max(MIN_RATIO, Math.min(MAX_RATIO, peak));
  return 10 * Math.log10(clamped / (1 - clamped));
}
