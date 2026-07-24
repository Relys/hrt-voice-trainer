import { describe, expect, it } from "vitest";
import { durandKerner } from "./polyroot.ts";

function sortedReal(roots: { re: number; im: number }[]): number[] {
  return roots.map((r) => r.re).sort((a, b) => a - b);
}

describe("durandKerner", () => {
  it("finds real roots of (z-1)(z-2)(z-3) = z^3 - 6z^2 + 11z - 6", () => {
    const roots = durandKerner([1, -6, 11, -6]);
    const reals = sortedReal(roots);
    expect(reals[0]).toBeCloseTo(1, 6);
    expect(reals[1]).toBeCloseTo(2, 6);
    expect(reals[2]).toBeCloseTo(3, 6);
    for (const r of roots) expect(Math.abs(r.im)).toBeLessThan(1e-6);
  });

  it("finds complex conjugate roots of z^2 + 1", () => {
    const roots = durandKerner([1, 0, 1]);
    const imags = roots.map((r) => r.im).sort((a, b) => a - b);
    expect(imags[0]).toBeCloseTo(-1, 6);
    expect(imags[1]).toBeCloseTo(1, 6);
    for (const r of roots) expect(Math.abs(r.re)).toBeLessThan(1e-6);
  });

  it("finds roots of a resonator polynomial with known pole radius/angle", () => {
    // (z - r*e^{i*theta})(z - r*e^{-i*theta}) = z^2 - 2r*cos(theta)*z + r^2
    const r = 0.9;
    const theta = 0.7;
    const coeffs = [1, -2 * r * Math.cos(theta), r * r];
    const roots = durandKerner(coeffs);
    for (const root of roots) {
      const mag = Math.hypot(root.re, root.im);
      expect(mag).toBeCloseTo(r, 5);
    }
    const angles = roots.map((root) => Math.abs(Math.atan2(root.im, root.re))).sort((a, b) => a - b);
    expect(angles[0]).toBeCloseTo(theta, 5);
    expect(angles[1]).toBeCloseTo(theta, 5);
  });
});
