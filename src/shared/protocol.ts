import type { Formant } from "../dsp/formants.ts";
import type { PitchEstimate } from "../dsp/yin.ts";

/** Messages posted from the AudioWorklet processor to the main thread. */
export interface AudioChunkMessage {
  type: "chunk";
  /** Mono PCM samples in [-1, 1], transferred (not copied). */
  samples: Float32Array;
  sampleRate: number;
}

/** Sent from the main thread to change analysis parameters (resolution/LPC-order settings). */
export interface ConfigureMessage {
  type: "configure";
  windowSeconds: number;
  lpcOrder: number;
}

/**
 * Sent after a batch of chunks fed all at once (not in real time, e.g. precomputing a whole
 * recorded clip's analysis up front). Because worker message handling is strictly FIFO, the
 * reply below is guaranteed to arrive only after every chunk queued ahead of it has been
 * processed and its spectrum result posted — a completion barrier with no extra bookkeeping.
 */
export interface FlushMessage {
  type: "flush";
}

export interface FlushCompleteMessage {
  type: "flush-complete";
}

/** Messages posted from the main thread to the analysis worker. */
export type WorkerInbound = AudioChunkMessage | ConfigureMessage | FlushMessage;

/** Messages posted from the analysis worker back to the main thread. */
export interface SpectrumResult {
  type: "spectrum";
  /** Magnitude spectrum, bins [0, fftSize/2]. */
  magnitudes: Float64Array;
  sampleRate: number;
  fftSize: number;
  /** Ascending by frequency; [0] is F1, [1] is F2, [2] is F3 if detected. */
  formants: Formant[];
  /** Fraction of spectral energy in the ~2.8-3.5kHz singer's-formant ("ring/twang") band. */
  ringTwangRatio: number;
  /** Null if the window was too short to search the configured pitch range. */
  pitch: PitchEstimate | null;
  /** Cepstral Peak Prominence (dB) — the standard "weight"/breathiness measure. */
  cppDb: number;
  /** Harmonic-to-Noise Ratio (dB) — periodicity strength; higher = clearer/less breathy. */
  hnrDb: number;
  /** Peak input amplitude for the most recent audio chunk, in dB full-scale. */
  inputLevelDb: number;
  /** True if the input signal is at or near full scale (risk of clipping). */
  clipping: boolean;
}

export type WorkerOutbound = SpectrumResult | FlushCompleteMessage;
