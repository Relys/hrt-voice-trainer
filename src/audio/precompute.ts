import type { AnalysisConfig } from "./capture.ts";
import type { PlaybackHandle } from "./playback.ts";
import type { AudioChunkMessage, ConfigureMessage, FlushMessage, SpectrumResult, WorkerOutbound } from "../shared/protocol.ts";

export interface TimestampedResult {
  timeSec: number;
  result: SpectrumResult;
}

const HOP_SECONDS = 0.01;
const CHUNK_SIZE = 512;
/** How far back to replay on a seek — enough to fully repopulate the scrolling views and let
 *  the feedback smoother's EMA/gate state settle, regardless of how long the whole clip is. */
const REPLAY_WINDOW_SEC = 12;
const REPLAY_WINDOW_FRAMES = Math.floor(REPLAY_WINDOW_SEC / HOP_SECONDS);

/**
 * Runs an entire recorded clip through the same analysis worker used for live capture, all at
 * once rather than paced in real time — the worker doesn't care how fast frames arrive, so this
 * finishes in a fraction of the clip's actual duration. Each frame is tagged with its
 * approximate timestamp (index * 10ms hop) so playback can later look up "what should the
 * display show at time T" instantly instead of waiting for it to scroll there.
 */
export async function precomputeAnalysis(blob: Blob, config: AnalysisConfig): Promise<TimestampedResult[]> {
  const decodeContext = new AudioContext();
  const arrayBuffer = await blob.arrayBuffer();
  const audioBuffer = await decodeContext.decodeAudioData(arrayBuffer);
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  void decodeContext.close();

  const worker = new Worker(new URL("../worker/analysis.worker.ts", import.meta.url));

  const results: TimestampedResult[] = [];
  let resultIndex = 0;

  const donePromise = new Promise<void>((resolve) => {
    worker.onmessage = (event: MessageEvent<WorkerOutbound>) => {
      const msg = event.data;
      if (msg.type === "spectrum") {
        results.push({ timeSec: resultIndex * HOP_SECONDS, result: msg });
        resultIndex++;
      } else if (msg.type === "flush-complete") {
        resolve();
      }
    };
  });

  const configure: ConfigureMessage = { type: "configure", ...config };
  worker.postMessage(configure);

  for (let i = 0; i < channelData.length; i += CHUNK_SIZE) {
    const end = Math.min(i + CHUNK_SIZE, channelData.length);
    const samples = new Float32Array(channelData.subarray(i, end)); // copy — a transferred subarray would detach the whole shared buffer
    const chunk: AudioChunkMessage = { type: "chunk", samples, sampleRate };
    worker.postMessage(chunk, [samples.buffer]);
  }
  const flush: FlushMessage = { type: "flush" };
  worker.postMessage(flush);

  await donePromise;
  worker.terminate();
  return results;
}

/**
 * Replays a precomputed timeline in sync with real (audible) audio playback.
 *
 * `onFrame` fires once per new frame during ordinary forward playback (cheap, one at a time —
 * same shape as live capture). `onSeekReplay` fires once, with a whole batch, whenever the
 * caller explicitly seeks — letting it do a single fast bulk redraw instead of replaying frame
 * by frame through renderers that were never meant to be called hundreds of times in one tick.
 *
 * Critically, "was this a seek" is tracked with an explicit flag set only by `seek()`/restart,
 * never inferred from how far the frame index moved between animation-frame ticks. Inferring it
 * from timing is a trap: if any single tick runs long for *any* reason, the next tick sees a
 * bigger-than-normal jump and misreads it as a seek, triggering another expensive replay that
 * makes the next tick late too — a self-reinforcing freeze with no actual seek involved.
 */
export async function startPrecomputedPlayback(
  timeline: TimestampedResult[],
  audioBlob: Blob,
  onFrame: (result: SpectrumResult) => void,
  onSeekReplay: (results: SpectrumResult[]) => void,
  onEnded: () => void,
): Promise<PlaybackHandle> {
  const objectUrl = URL.createObjectURL(audioBlob);
  const audioEl = new Audio();
  audioEl.src = objectUrl;

  await new Promise<void>((resolve) => {
    if (audioEl.readyState >= 1) resolve();
    else audioEl.addEventListener("loadedmetadata", () => resolve(), { once: true });
  });

  let lastIndex = -1;
  let pendingReplay = true; // first tick always populates from scratch
  let rafHandle: number | undefined;
  let timeUpdateCb: ((currentTime: number, duration: number) => void) | null = null;

  function tick(): void {
    const targetIndex = timeline.length > 0 ? Math.min(timeline.length - 1, Math.floor(audioEl.currentTime / HOP_SECONDS)) : -1;
    if (targetIndex !== lastIndex && targetIndex >= 0) {
      const gap = targetIndex - lastIndex;
      // A negative or abnormally large gap can't be normal frame-to-frame drift (e.g. the tab
      // was backgrounded and rAF paused for a while) — treat it the same as an explicit seek
      // rather than trying to catch up through an unbounded number of frames.
      if (pendingReplay || gap < 0 || gap > REPLAY_WINDOW_FRAMES) {
        const startIndex = Math.max(0, targetIndex - REPLAY_WINDOW_FRAMES);
        const batch: SpectrumResult[] = [];
        for (let i = startIndex; i <= targetIndex; i++) {
          const entry = timeline[i];
          if (entry) batch.push(entry.result);
        }
        onSeekReplay(batch);
        pendingReplay = false;
      } else {
        for (let i = lastIndex + 1; i <= targetIndex; i++) {
          const entry = timeline[i];
          if (entry) onFrame(entry.result);
        }
      }
      lastIndex = targetIndex;
    }
    timeUpdateCb?.(audioEl.currentTime, audioEl.duration || 0);
    if (!audioEl.paused) rafHandle = requestAnimationFrame(tick);
  }

  audioEl.addEventListener("ended", onEnded);

  await audioEl.play();
  tick();

  return {
    play: () => {
      if (audioEl.currentTime >= (audioEl.duration || Infinity) - 0.05) {
        audioEl.currentTime = 0;
        pendingReplay = true;
      }
      void audioEl.play();
      tick();
    },
    pause: () => {
      audioEl.pause();
      if (rafHandle !== undefined) cancelAnimationFrame(rafHandle);
    },
    seek: (seconds: number) => {
      audioEl.currentTime = Math.max(0, Math.min(audioEl.duration || seconds, seconds));
      pendingReplay = true;
      tick();
    },
    getCurrentTime: () => audioEl.currentTime,
    getDuration: () => audioEl.duration || 0,
    isPaused: () => audioEl.paused,
    onTimeUpdate: (cb) => {
      timeUpdateCb = cb;
    },
    stop: () => {
      audioEl.pause();
      if (rafHandle !== undefined) cancelAnimationFrame(rafHandle);
      URL.revokeObjectURL(objectUrl);
    },
  };
}
