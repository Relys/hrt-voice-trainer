import { wireAnalysisPipeline, type AnalysisConfig } from "./capture.ts";
import type { SpectrumResult } from "../shared/protocol.ts";

export interface PlaybackHandle {
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  isPaused: () => boolean;
  onTimeUpdate: (cb: (currentTime: number, duration: number) => void) => void;
  stop: () => void;
}

/**
 * Decodes a recorded clip and replays it through the same analysis pipeline as live capture,
 * so the spectrogram/HUD reproduce exactly what they showed live. Uses a real HTMLAudioElement
 * (rather than an AudioBufferSourceNode) specifically so pause/seek are native browser behavior
 * instead of something we'd have to fake by tearing down and recreating a one-shot buffer node.
 */
export async function startPlayback(
  blob: Blob,
  onSpectrum: (result: SpectrumResult) => void,
  initialConfig: AnalysisConfig | undefined,
  onEnded: () => void,
): Promise<PlaybackHandle> {
  const audioContext = new AudioContext();
  // A paused HTMLMediaElement still outputs silence through the graph — the worklet would
  // otherwise keep processing (and the worker keep emitting near-empty frames) forever while
  // paused. Suspending the whole context stops the graph from advancing at all while paused;
  // the `audioEl.paused` guard below covers the brief async gap before suspend() takes effect.
  const pipeline = await wireAnalysisPipeline(
    audioContext,
    (result) => {
      if (!audioEl.paused) onSpectrum(result);
    },
    initialConfig,
  );

  const objectUrl = URL.createObjectURL(blob);
  const audioEl = new Audio();
  audioEl.src = objectUrl;

  const sourceNode = audioContext.createMediaElementSource(audioEl);

  // Analysis path stays silent (matches live capture); a separate direct path makes it audible.
  const silence = audioContext.createGain();
  silence.gain.value = 0;
  sourceNode.connect(pipeline.captureNode);
  pipeline.captureNode.connect(silence);
  silence.connect(audioContext.destination);
  sourceNode.connect(audioContext.destination);

  await new Promise<void>((resolve) => {
    if (audioEl.readyState >= 1) resolve();
    else audioEl.addEventListener("loadedmetadata", () => resolve(), { once: true });
  });

  let timeUpdateCb: ((currentTime: number, duration: number) => void) | null = null;
  audioEl.addEventListener("timeupdate", () => {
    timeUpdateCb?.(audioEl.currentTime, audioEl.duration || 0);
  });
  // Reaching the end pauses the element per spec (audioEl.paused becomes true) — just let the
  // caller know playback stopped; it stays fully wired up so rewinding and replaying works.
  audioEl.addEventListener("ended", () => {
    void audioContext.suspend();
    onEnded();
  });

  await audioContext.resume();
  await audioEl.play();

  return {
    play: () => {
      // Replaying from the very end otherwise no-ops (there's nothing left to play).
      if (audioEl.currentTime >= (audioEl.duration || Infinity) - 0.05) audioEl.currentTime = 0;
      sourceNode.connect(pipeline.captureNode);
      void audioContext.resume();
      void audioEl.play();
    },
    pause: () => {
      audioEl.pause();
      // Belt-and-suspenders alongside the `audioEl.paused` check inside wireAnalysisPipeline's
      // callback above: `audioContext.suspend()` is asynchronous, so the render graph (and the
      // worklet feeding the analysis worker) can keep running for a bit after this returns.
      // Physically cutting the source -> analysis connection stops new chunks from being
      // generated at all, rather than trusting that every in-flight one gets filtered in time.
      sourceNode.disconnect(pipeline.captureNode);
      void audioContext.suspend();
    },
    seek: (seconds: number) => {
      audioEl.currentTime = Math.max(0, Math.min(audioEl.duration || seconds, seconds));
    },
    getCurrentTime: () => audioEl.currentTime,
    getDuration: () => audioEl.duration || 0,
    isPaused: () => audioEl.paused,
    onTimeUpdate: (cb) => {
      timeUpdateCb = cb;
    },
    stop: () => {
      pipeline.teardown();
      audioEl.pause();
      sourceNode.disconnect();
      silence.disconnect();
      URL.revokeObjectURL(objectUrl);
      void audioContext.close();
    },
  };
}
