import type { AudioChunkMessage, ConfigureMessage, SpectrumResult } from "../shared/protocol.ts";

export type CaptureSource = "microphone" | "display";

/** No mainstream mobile browser implements getDisplayMedia yet — it's desktop-only for now. */
export function isDisplayCaptureSupported(): boolean {
  return typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

export interface AnalysisConfig {
  windowSeconds: number;
  lpcOrder: number;
}

export interface CaptureHandle {
  /** Resolves to the recorded clip if `record` was requested and MediaRecorder produced data. */
  stop: () => Promise<Blob | null>;
  configure: (config: AnalysisConfig) => void;
  /** Adjusts the live mic gain (dB) applied before analysis/recording — takes effect immediately. */
  setInputGainDb: (db: number) => void;
}

function dbToLinearGain(db: number): number {
  return Math.pow(10, db / 20);
}

interface AnalysisPipeline {
  captureNode: AudioWorkletNode;
  configure: (config: AnalysisConfig) => void;
  teardown: () => void;
}

/** Loads the worklet + spins up the analysis worker; shared by live capture and clip playback. */
export async function wireAnalysisPipeline(
  audioContext: AudioContext,
  onSpectrum: (result: SpectrumResult) => void,
  initialConfig?: AnalysisConfig,
): Promise<AnalysisPipeline> {
  // ?no-inline: Vite's default asset handling would otherwise inline this small file as a
  // data: URL. Plain .js (not .ts) since Vite doesn't transpile arbitrary `new URL(...)` asset
  // references the way it does for Worker — a .ts source would get copied in untranspiled.
  await audioContext.audioWorklet.addModule(new URL("./worklet-processor.js?no-inline", import.meta.url));
  const captureNode = new AudioWorkletNode(audioContext, "voice-capture-processor");

  const worker = new Worker(new URL("../worker/analysis.worker.ts", import.meta.url));
  worker.onmessage = (event: MessageEvent<SpectrumResult>) => onSpectrum(event.data);
  if (initialConfig) {
    const configure: ConfigureMessage = { type: "configure", ...initialConfig };
    worker.postMessage(configure);
  }

  captureNode.port.onmessage = (event: MessageEvent<AudioChunkMessage>) => {
    const chunk = event.data;
    worker.postMessage(chunk, [chunk.samples.buffer]);
  };

  return {
    captureNode,
    configure: (config: AnalysisConfig) => {
      const configure: ConfigureMessage = { type: "configure", ...config };
      worker.postMessage(configure);
    },
    teardown: () => {
      captureNode.port.onmessage = null;
      worker.onmessage = null;
      worker.terminate();
      captureNode.disconnect();
    },
  };
}

/**
 * Picks the best codec this browser actually supports for recording, rather than leaving it to
 * an unstated default. Browsers vary a lot here (Chrome/Firefox favor webm/opus, Safari mp4/aac)
 * — explicit selection means we always know what we produced (stored as the session's
 * audioMimeType), even though a clip recorded in one browser still isn't guaranteed to decode
 * in another; there's no fixing that without transcoding, which is out of scope here.
 */
function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  const preferred = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/mp4"];
  return preferred.find((type) => MediaRecorder.isTypeSupported(type));
}

async function acquireStream(captureSource: CaptureSource, deviceId?: string): Promise<MediaStream> {
  if (captureSource === "microphone") {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    });
  }

  // Tab/window/screen audio — e.g. an instructor capturing a student's voice from a call or
  // recording playing in another tab. The browser's own share picker chooses *what*; we only
  // choose *that audio is requested*. Video comes along whether we want it or not, so grab the
  // audio track and drop the video track immediately.
  if (!isDisplayCaptureSupported()) {
    throw new Error("Tab/Screen Audio isn't supported on this browser — no mobile browser implements it yet. Use Microphone instead.");
  }
  const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  const audioTracks = displayStream.getAudioTracks();
  for (const track of displayStream.getVideoTracks()) track.stop();
  if (audioTracks.length === 0) {
    for (const track of audioTracks) track.stop();
    throw new Error("The shared tab/window didn't include audio — re-share and enable \"Share audio\".");
  }
  return new MediaStream(audioTracks);
}

export async function startCapture(
  onSpectrum: (result: SpectrumResult) => void,
  captureSource: CaptureSource,
  deviceId?: string,
  initialConfig?: AnalysisConfig,
  options: { record?: boolean; gainDb?: number } = {},
): Promise<CaptureHandle> {
  const stream = await acquireStream(captureSource, deviceId);

  const audioContext = new AudioContext();
  const pipeline = await wireAnalysisPipeline(audioContext, onSpectrum, initialConfig);

  const sourceNode = audioContext.createMediaStreamSource(stream);

  // Sensitivity/gain applied before BOTH analysis and recording, so a recorded clip's later
  // playback reflects the same level the user saw/heard live rather than the raw, unadjusted mic.
  const inputGain = audioContext.createGain();
  inputGain.gain.value = dbToLinearGain(options.gainDb ?? 0);
  sourceNode.connect(inputGain);

  // Browsers can skip processing nodes that never reach the destination, so
  // route through a silent gain node instead of leaving captureNode dangling.
  const silence = audioContext.createGain();
  silence.gain.value = 0;
  inputGain.connect(pipeline.captureNode);
  pipeline.captureNode.connect(silence);
  silence.connect(audioContext.destination);

  let recorder: MediaRecorder | undefined;
  let recordDestination: MediaStreamAudioDestinationNode | undefined;
  const chunks: Blob[] = [];
  if (options.record && typeof MediaRecorder !== "undefined") {
    try {
      recordDestination = audioContext.createMediaStreamDestination();
      inputGain.connect(recordDestination);
      const mimeType = pickRecorderMimeType();
      recorder = new MediaRecorder(recordDestination.stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.start();
    } catch (err) {
      console.warn("MediaRecorder unavailable — this session won't have a recording:", err);
    }
  }

  return {
    configure: pipeline.configure,
    setInputGainDb: (db) => {
      inputGain.gain.value = dbToLinearGain(db);
    },
    stop: async () => {
      pipeline.teardown();
      sourceNode.disconnect();
      inputGain.disconnect();
      silence.disconnect();
      recordDestination?.disconnect();

      let blob: Blob | null = null;
      if (recorder && recorder.state !== "inactive") {
        const mimeType = recorder.mimeType;
        blob = await new Promise<Blob | null>((resolve) => {
          recorder!.onstop = () => resolve(chunks.length > 0 ? new Blob(chunks, { type: mimeType }) : null);
          recorder!.stop();
        });
      }

      for (const track of stream.getTracks()) track.stop();
      void audioContext.close();
      return blob;
    },
  };
}
