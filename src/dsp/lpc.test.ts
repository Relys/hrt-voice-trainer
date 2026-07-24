import { describe, expect, it } from "vitest";
import { autocorrelate, levinsonDurbin } from "./lpc.ts";

describe("levinsonDurbin", () => {
  it("recovers the coefficients of a known 2-pole AR process", () => {
    // x[n] = -a1*x[n-1] - a2*x[n-2] + noise, driven by a fixed pseudo-random seed.
    const a1 = -1.2;
    const a2 = 0.72;
    const n = 4096;
    const x = new Float64Array(n);
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff - 0.5;
    };
    for (let i = 2; i < n; i++) {
      x[i] = -a1 * x[i - 1] - a2 * x[i - 2] + rand() * 0.01;
    }

    const r = autocorrelate(x, 2);
    const { coefficients } = levinsonDurbin(r, 2);

    expect(coefficients[1]).toBeCloseTo(a1, 1);
    expect(coefficients[2]).toBeCloseTo(a2, 1);
  });

  it("returns a stable all-pass identity when the signal is silence", () => {
    const r = new Float64Array(5);
    const { coefficients, error } = levinsonDurbin(r, 4);
    expect(coefficients[0]).toBe(1);
    expect(error).toBe(0);
  });
});
