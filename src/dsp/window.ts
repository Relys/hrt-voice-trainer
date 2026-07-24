/** Periodic Hann window, precomputed once and reused per frame. */
export function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n));
  }
  return w;
}

export function applyWindow(frame: Float64Array, window: Float64Array): Float64Array {
  const out = new Float64Array(frame.length);
  for (let i = 0; i < frame.length; i++) out[i] = frame[i] * window[i];
  return out;
}
