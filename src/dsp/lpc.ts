export function autocorrelate(x: Float64Array, maxLag: number): Float64Array {
  const r = new Float64Array(maxLag + 1);
  const n = x.length;
  for (let lag = 0; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) sum += x[i] * x[i + lag];
    r[lag] = sum;
  }
  return r;
}

export interface LevinsonResult {
  /** a[0] = 1; A(z) = sum(a[i] * z^-i), prediction error e[n] = x[n] + sum(a[i] * x[n-i]). */
  coefficients: Float64Array;
  error: number;
}

/** Levinson-Durbin recursion: solves the normal equations for LPC coefficients in O(order^2). */
export function levinsonDurbin(r: Float64Array, order: number): LevinsonResult {
  const a = new Float64Array(order + 1);
  a[0] = 1;
  let e = r[0];
  if (e === 0) return { coefficients: a, error: 0 };

  for (let i = 1; i <= order; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    const k = -acc / e;

    const updated = new Float64Array(order + 1);
    updated[0] = 1;
    for (let j = 1; j < i; j++) updated[j] = a[j] + k * a[i - j];
    updated[i] = k;
    a.set(updated);

    e *= 1 - k * k;
    if (e <= 0) break;
  }
  return { coefficients: a, error: e };
}
