import { describe, expect, it } from "vitest";
import { computeCpp } from "./cpp.ts";
import { nextPowerOfTwo, realFftMagnitude } from "./fft.ts";
import { applyWindow, hannWindow } from "./window.ts";

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

/** A periodic, formant-shaped "vowel" — much richer harmonically than a few summed sinusoids. */
function synthesizeVoicedFrame(sampleRate: number, f0: number, frameLength: number): Float64Array {
  const totalLength = frameLength + 4000;
  const source = generateImpulseTrain(totalLength, sampleRate, f0);
  const withF1 = applyResonator(source, 500, 80, sampleRate);
  const withF2 = applyResonator(withF1, 1500, 100, sampleRate);
  return withF2.slice(withF2.length - frameLength);
}

function seededNoise(n: number, seed = 99): Float64Array {
  const signal = new Float64Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    signal[i] = (s / 0x7fffffff) * 2 - 1;
  }
  return signal;
}

function magnitudesFor(signal: Float64Array): { magnitudes: Float64Array; fftSize: number } {
  const fftSize = nextPowerOfTwo(signal.length);
  const padded = new Float64Array(fftSize);
  padded.set(signal);
  const windowed = applyWindow(padded, hannWindow(fftSize));
  return { magnitudes: realFftMagnitude(windowed), fftSize };
}

describe("computeCpp", () => {
  it("reports high CPP for a periodic, formant-shaped voiced frame", () => {
    const sampleRate = 44100;
    const signal = synthesizeVoicedFrame(sampleRate, 150, 2048);
    const { magnitudes, fftSize } = magnitudesFor(signal);
    const cpp = computeCpp(magnitudes, fftSize, sampleRate);
    expect(cpp).toBeGreaterThan(10);
  });

  it("reports low CPP for white noise", () => {
    const sampleRate = 44100;
    const signal = seededNoise(2048);
    const { magnitudes, fftSize } = magnitudesFor(signal);
    const cpp = computeCpp(magnitudes, fftSize, sampleRate);
    expect(cpp).toBeLessThan(3);
  });

  it("scores a periodic voiced frame clearly higher than noise", () => {
    const sampleRate = 44100;
    const voiced = magnitudesFor(synthesizeVoicedFrame(sampleRate, 200, 2048));
    const noise = magnitudesFor(seededNoise(2048));
    const voicedCpp = computeCpp(voiced.magnitudes, voiced.fftSize, sampleRate);
    const noiseCpp = computeCpp(noise.magnitudes, noise.fftSize, sampleRate);
    expect(voicedCpp).toBeGreaterThan(noiseCpp + 5);
  });
});
