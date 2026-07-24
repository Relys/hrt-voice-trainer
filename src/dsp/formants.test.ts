import { describe, expect, it } from "vitest";
import { estimateFormants } from "./formants.ts";

/** Two-pole resonator: y[n] = x[n] + a1*y[n-1] + a2*y[n-2]. */
function applyResonator(x: Float64Array, freq: number, bandwidth: number, sampleRate: number): Float64Array {
  const r = Math.exp((-Math.PI * bandwidth) / sampleRate);
  const theta = (2 * Math.PI * freq) / sampleRate;
  const a1 = 2 * r * Math.cos(theta);
  const a2 = -r * r;
  const y = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const prev1 = i >= 1 ? y[i - 1] : 0;
    const prev2 = i >= 2 ? y[i - 2] : 0;
    y[i] = x[i] + a1 * prev1 + a2 * prev2;
  }
  return y;
}

function generateImpulseTrain(n: number, sampleRate: number, f0: number): Float64Array {
  const period = sampleRate / f0;
  const signal = new Float64Array(n);
  let nextPulse = 0;
  for (let i = 0; i < n; i++) {
    if (i >= nextPulse) {
      signal[i] = 1;
      nextPulse += period;
    }
  }
  return signal;
}

function synthesizeVowel(
  sampleRate: number,
  f0: number,
  f1: number,
  f2: number,
  frameLength: number,
): Float64Array {
  const totalLength = frameLength + 4000; // let the resonator settle past the initial transient
  const source = generateImpulseTrain(totalLength, sampleRate, f0);
  const withF1 = applyResonator(source, f1, 80, sampleRate);
  const withF2 = applyResonator(withF1, f2, 100, sampleRate);
  return withF2.slice(withF2.length - frameLength);
}

describe("estimateFormants", () => {
  it("recovers F1/F2 of a synthesized vowel-like resonance", () => {
    const sampleRate = 44100;
    const targetF1 = 500;
    const targetF2 = 1500;
    const frame = synthesizeVowel(sampleRate, 120, targetF1, targetF2, 1400);

    const formants = estimateFormants(frame, sampleRate);
    expect(formants.length).toBeGreaterThanOrEqual(2);

    const closestTo = (target: number) =>
      formants.reduce((best, f) => (Math.abs(f.frequency - target) < Math.abs(best.frequency - target) ? f : best));

    const f1 = closestTo(targetF1);
    const f2 = closestTo(targetF2);
    expect(f1.frequency).toBeGreaterThan(targetF1 * 0.85);
    expect(f1.frequency).toBeLessThan(targetF1 * 1.15);
    expect(f2.frequency).toBeGreaterThan(targetF2 * 0.85);
    expect(f2.frequency).toBeLessThan(targetF2 * 1.15);
  });

  it("recovers a different vowel's F1/F2 (higher, closer formants)", () => {
    const sampleRate = 44100;
    const targetF1 = 300;
    const targetF2 = 2200;
    const frame = synthesizeVowel(sampleRate, 150, targetF1, targetF2, 1400);

    const formants = estimateFormants(frame, sampleRate);
    const closestTo = (target: number) =>
      formants.reduce((best, f) => (Math.abs(f.frequency - target) < Math.abs(best.frequency - target) ? f : best));

    const f1 = closestTo(targetF1);
    const f2 = closestTo(targetF2);
    expect(f1.frequency).toBeGreaterThan(targetF1 * 0.8);
    expect(f1.frequency).toBeLessThan(targetF1 * 1.2);
    expect(f2.frequency).toBeGreaterThan(targetF2 * 0.85);
    expect(f2.frequency).toBeLessThan(targetF2 * 1.15);
  });

  it("returns an empty list for silence", () => {
    const frame = new Float64Array(1400);
    expect(estimateFormants(frame, 44100)).toEqual([]);
  });
});
