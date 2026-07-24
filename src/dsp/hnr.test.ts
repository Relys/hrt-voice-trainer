import { describe, expect, it } from "vitest";
import { computeHnr } from "./hnr.ts";

/** Two-pole resonator, same synthesis approach as formants.test.ts. */
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

function synthesizeVoicedFrame(sampleRate: number, f0: number, frameLength: number): Float64Array {
  const totalLength = frameLength + 4000;
  const source = generateImpulseTrain(totalLength, sampleRate, f0);
  const withF1 = applyResonator(source, 500, 80, sampleRate);
  const withF2 = applyResonator(withF1, 1500, 100, sampleRate);
  return withF2.slice(withF2.length - frameLength);
}

function seededNoise(n: number, seed = 123): Float64Array {
  const signal = new Float64Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    signal[i] = (s / 0x7fffffff) * 2 - 1;
  }
  return signal;
}

describe("computeHnr", () => {
  it("reports high HNR for a periodic, formant-shaped voiced frame", () => {
    const sampleRate = 44100;
    const frame = synthesizeVoicedFrame(sampleRate, 150, 2048);
    // Real HNR for healthy voiced phonation is commonly cited in roughly the 7-20dB range;
    // this synthetic frame isn't a perfectly idealized periodic signal, so aim within that band.
    expect(computeHnr(frame, sampleRate)).toBeGreaterThan(7);
  });

  it("reports low HNR for white noise", () => {
    const sampleRate = 44100;
    const frame = seededNoise(2048);
    expect(computeHnr(frame, sampleRate)).toBeLessThan(5);
  });

  it("scores a periodic voiced frame clearly higher than noise", () => {
    const sampleRate = 44100;
    const voiced = synthesizeVoicedFrame(sampleRate, 200, 2048);
    const noise = seededNoise(2048);
    expect(computeHnr(voiced, sampleRate)).toBeGreaterThan(computeHnr(noise, sampleRate) + 10);
  });
});
