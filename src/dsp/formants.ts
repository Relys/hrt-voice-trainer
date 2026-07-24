import { abs, type Complex } from "./complex.ts";
import { decimate } from "./decimate.ts";
import { autocorrelate, levinsonDurbin } from "./lpc.ts";
import { durandKerner } from "./polyroot.ts";
import { applyWindow, hannWindow } from "./window.ts";

export interface Formant {
  frequency: number;
  bandwidth: number;
}

export const DEFAULT_LPC_ORDER = 12;
const TARGET_DECIMATED_RATE = 11000;
const MIN_FORMANT_HZ = 90;
const MAX_FORMANT_BANDWIDTH_HZ = 500;
const PRE_EMPHASIS = 0.97;

function preEmphasize(signal: Float64Array): Float64Array {
  const out = new Float64Array(signal.length);
  out[0] = signal[0];
  for (let i = 1; i < signal.length; i++) out[i] = signal[i] - PRE_EMPHASIS * signal[i - 1];
  return out;
}

/**
 * Estimates formant frequencies via LPC: decimate to ~11kHz (formants of interest
 * live below 5kHz; downsampling first keeps a low LPC order well-conditioned),
 * pre-emphasize, window, solve for LPC coefficients, then root the LPC polynomial.
 * Returns candidates sorted ascending by frequency; index 0 is F1, index 1 is F2.
 */
export function estimateFormants(
  frame: Float64Array,
  sampleRate: number,
  lpcOrder: number = DEFAULT_LPC_ORDER,
): Formant[] {
  const factor = Math.max(1, Math.round(sampleRate / TARGET_DECIMATED_RATE));
  const effectiveRate = sampleRate / factor;
  const decimated = decimate(frame, factor, sampleRate);
  if (decimated.length < lpcOrder * 2) return [];

  const emphasized = preEmphasize(decimated);
  const windowed = applyWindow(emphasized, hannWindow(emphasized.length));

  const r = autocorrelate(windowed, lpcOrder);
  if (r[0] === 0) return [];
  const { coefficients } = levinsonDurbin(r, lpcOrder);

  const roots: Complex[] = durandKerner(Array.from(coefficients));

  const formants: Formant[] = [];
  for (const root of roots) {
    if (root.im <= 0) continue; // one root per conjugate pair
    const magnitude = abs(root);
    if (magnitude <= 0 || magnitude >= 1) continue; // must be a stable pole
    const theta = Math.atan2(root.im, root.re);
    const frequency = (theta * effectiveRate) / (2 * Math.PI);
    const bandwidth = (-Math.log(magnitude) * effectiveRate) / Math.PI;
    if (frequency < MIN_FORMANT_HZ || frequency > (effectiveRate / 2) * 0.95) continue;
    if (bandwidth > MAX_FORMANT_BANDWIDTH_HZ) continue;
    formants.push({ frequency, bandwidth });
  }
  formants.sort((a, b) => a.frequency - b.frequency);
  return formants;
}
