import { describe, expect, it } from "vitest";
import { fft, ifft, nextPowerOfTwo, realFftMagnitude } from "./fft.ts";

/** O(n^2) reference DFT, used only to validate the fast implementation. */
function bruteForceDft(re: Float64Array, im: Float64Array): { re: Float64Array; im: Float64Array } {
  const n = re.length;
  const outRe = new Float64Array(n);
  const outIm = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sumRe = 0;
    let sumIm = 0;
    for (let t = 0; t < n; t++) {
      const ang = (-2 * Math.PI * k * t) / n;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      sumRe += re[t] * c - im[t] * s;
      sumIm += re[t] * s + im[t] * c;
    }
    outRe[k] = sumRe;
    outIm[k] = sumIm;
  }
  return { re: outRe, im: outIm };
}

function closeArrays(a: Float64Array, b: Float64Array, eps = 1e-6): void {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    expect(a[i]).toBeCloseTo(b[i], 6);
  }
  void eps;
}

describe("fft", () => {
  it("matches brute-force DFT on random data", () => {
    const n = 64;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < n; i++) {
      re[i] = rand() * 2 - 1;
      im[i] = rand() * 2 - 1;
    }
    const expected = bruteForceDft(re, im);
    const gotRe = Float64Array.from(re);
    const gotIm = Float64Array.from(im);
    fft(gotRe, gotIm);
    closeArrays(gotRe, expected.re);
    closeArrays(gotIm, expected.im);
  });

  it("rejects non-power-of-two lengths", () => {
    expect(() => fft(new Float64Array(6), new Float64Array(6))).toThrow();
  });

  it("round-trips through ifft", () => {
    const n = 128;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 5 * i) / n);
    const originalRe = Float64Array.from(re);
    const originalIm = Float64Array.from(im);
    fft(re, im);
    ifft(re, im);
    closeArrays(re, originalRe, 1e-9);
    closeArrays(im, originalIm, 1e-9);
  });

  it("places a pure sinusoid's energy at the expected bin", () => {
    const n = 1024;
    const sampleRate = 16000;
    const freq = 440; // A4
    const input = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      input[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
    }
    const mags = realFftMagnitude(input);
    const expectedBin = Math.round((freq * n) / sampleRate);

    let peakBin = 0;
    let peakMag = -Infinity;
    for (let k = 1; k < mags.length; k++) {
      if (mags[k] > peakMag) {
        peakMag = mags[k];
        peakBin = k;
      }
    }
    expect(peakBin).toBe(expectedBin);
  });

  it("computes next power of two correctly", () => {
    expect(nextPowerOfTwo(1)).toBe(1);
    expect(nextPowerOfTwo(2)).toBe(2);
    expect(nextPowerOfTwo(3)).toBe(4);
    expect(nextPowerOfTwo(1024)).toBe(1024);
    expect(nextPowerOfTwo(1025)).toBe(2048);
  });
});
