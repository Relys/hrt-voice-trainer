import { bandEnergyRatio, RING_TWANG_BAND_HZ } from "../dsp/band-energy.ts";
import { computeCpp } from "../dsp/cpp.ts";
import { DEFAULT_LPC_ORDER, estimateFormants } from "../dsp/formants.ts";
import { computeHnr } from "../dsp/hnr.ts";
import { realFftMagnitude, nextPowerOfTwo } from "../dsp/fft.ts";
import { hannWindow, applyWindow } from "../dsp/window.ts";
import { SlidingBuffer } from "../dsp/sliding-buffer.ts";
import { estimatePitch } from "../dsp/yin.ts";
import type { FlushCompleteMessage, SpectrumResult, WorkerInbound } from "../shared/protocol.ts";

const HOP_SECONDS = 0.01;
const DEFAULT_WINDOW_SECONDS = 0.032;
const CLIPPING_THRESHOLD = 0.98;

let buffer: SlidingBuffer | undefined;
let window: Float64Array | undefined;
let fftSize = 0;
let sampleRate = 0;
let windowSeconds = DEFAULT_WINDOW_SECONDS;
let lpcOrder = DEFAULT_LPC_ORDER;
let latestInputLevelDb = -Infinity;
let latestClipping = false;

function reinitialize(rate: number): void {
  sampleRate = rate;
  fftSize = nextPowerOfTwo(Math.round(rate * windowSeconds));
  const hopSize = Math.max(1, Math.round(rate * HOP_SECONDS));
  buffer = new SlidingBuffer(fftSize, hopSize);
  window = hannWindow(fftSize);
}

self.onmessage = (event: MessageEvent<WorkerInbound>) => {
  const msg = event.data;

  if (msg.type === "configure") {
    windowSeconds = msg.windowSeconds;
    lpcOrder = msg.lpcOrder;
    if (sampleRate) reinitialize(sampleRate);
    return;
  }

  if (msg.type === "flush") {
    const flushComplete: FlushCompleteMessage = { type: "flush-complete" };
    self.postMessage(flushComplete);
    return;
  }

  const { samples, sampleRate: rate } = msg;
  if (!buffer || rate !== sampleRate) reinitialize(rate);

  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }
  latestInputLevelDb = 20 * Math.log10(peak + 1e-12);
  latestClipping = peak >= CLIPPING_THRESHOLD;

  buffer!.push(samples);

  for (const frame of buffer!.drainWindows()) {
    const windowed = applyWindow(frame, window!);
    const magnitudes = realFftMagnitude(windowed);
    const formants = estimateFormants(frame, sampleRate, lpcOrder);
    const ringTwangRatio = bandEnergyRatio(
      magnitudes,
      sampleRate,
      fftSize,
      RING_TWANG_BAND_HZ[0],
      RING_TWANG_BAND_HZ[1],
    );
    const pitch = estimatePitch(frame, sampleRate);
    const cppDb = computeCpp(magnitudes, fftSize, sampleRate);
    const hnrDb = computeHnr(frame, sampleRate);
    const result: SpectrumResult = {
      type: "spectrum",
      magnitudes,
      sampleRate,
      fftSize,
      formants,
      ringTwangRatio,
      pitch,
      cppDb,
      hnrDb,
      inputLevelDb: latestInputLevelDb,
      clipping: latestClipping,
    };
    self.postMessage(result, [magnitudes.buffer]);
  }
};
