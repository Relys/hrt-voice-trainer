/**
 * In-place iterative radix-2 Cooley-Tukey FFT.
 * `re`/`im` length must be a power of two.
 */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n !== im.length) throw new Error("fft: re/im length mismatch");
  if (n === 0) return;
  if ((n & (n - 1)) !== 0) throw new Error("fft: length must be a power of two");

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + half] * curRe - im[i + k + half] * curIm;
        const vIm = re[i + k + half] * curIm + im[i + k + half] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + half] = uRe - vRe;
        im[i + k + half] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        const nextIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
        curIm = nextIm;
      }
    }
  }
}

/** In-place inverse FFT (unnormalized conjugate trick, then scale by 1/n). */
export function ifft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fft(re, im);
  for (let i = 0; i < n; i++) {
    re[i] = re[i] / n;
    im[i] = -im[i] / n;
  }
}

/**
 * Real-input FFT: returns magnitude spectrum for bins [0, n/2] inclusive.
 * `input` length must be a power of two.
 */
export function realFftMagnitude(input: Float32Array | Float64Array): Float64Array {
  const n = input.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(input);
  fft(re, im);
  const mags = new Float64Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k++) {
    mags[k] = Math.hypot(re[k], im[k]);
  }
  return mags;
}

export function nextPowerOfTwo(x: number): number {
  let p = 1;
  while (p < x) p <<= 1;
  return p;
}
