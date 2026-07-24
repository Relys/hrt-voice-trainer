import { describe, expect, it } from "vitest";
import { estimatePitch } from "./yin.ts";

function synthesizeTone(sampleRate: number, f0: number, harmonics: number[], n: number): Float64Array {
  const signal = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sample = 0;
    for (const h of harmonics) sample += Math.sin((2 * Math.PI * f0 * h * i) / sampleRate) / h;
    signal[i] = sample;
  }
  return signal;
}

function seededNoise(n: number, seed = 7): Float64Array {
  const signal = new Float64Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    signal[i] = (s / 0x7fffffff) * 2 - 1;
  }
  return signal;
}

describe("estimatePitch", () => {
  it("recovers F0 of a pure sinusoid with high clarity", () => {
    const sampleRate = 44100;
    const result = estimatePitch(synthesizeTone(sampleRate, 150, [1], 1400), sampleRate);
    expect(result).not.toBeNull();
    expect(result!.frequency).toBeCloseTo(150, 0);
    expect(result!.clarity).toBeGreaterThan(0.95);
  });

  it("recovers F0 of a harmonic-rich voice-like tone", () => {
    const sampleRate = 44100;
    const result = estimatePitch(synthesizeTone(sampleRate, 120, [1, 2, 3, 4, 5], 1400), sampleRate);
    expect(result).not.toBeNull();
    expect(result!.frequency).toBeCloseTo(120, 0);
    expect(result!.clarity).toBeGreaterThan(0.9);
  });

  it("recovers a higher F0 within range", () => {
    const sampleRate = 44100;
    const result = estimatePitch(synthesizeTone(sampleRate, 250, [1, 2, 3], 1400), sampleRate);
    expect(result).not.toBeNull();
    expect(result!.frequency).toBeCloseTo(250, 0);
  });

  it("reports low clarity for white noise", () => {
    const result = estimatePitch(seededNoise(1400), 44100);
    expect(result).not.toBeNull();
    expect(result!.clarity).toBeLessThan(0.5);
  });

  it("returns null when the frame is too short for the requested range", () => {
    const result = estimatePitch(new Float64Array(50), 44100);
    expect(result).toBeNull();
  });
});
