import type { Formant } from "../dsp/formants.ts";
import type { SpectrumResult } from "../shared/protocol.ts";

export interface SmoothedFeedback {
  formants: Formant[];
  ringTwangRatio: number;
  pitchHz: number | null;
  cppDb: number;
  hnrDb: number;
  /** Mean of whichever of F1/F2/F3 are currently present; null if fewer than 2 are available. */
  avgFormantHz: number | null;
  /** Rolling pitch stddev in semitones ("inflection"); null until enough voiced samples accumulate. */
  inflectionSemitones: number | null;
  /** Frame-to-frame (not true cycle-to-cycle) pitch perturbation approximation, as a percent. */
  jitterPercent: number | null;
  /** Frame-to-frame (not true cycle-to-cycle) amplitude perturbation approximation, as a percent. */
  shimmerPercent: number | null;
  hasSignal: boolean;
}

const EMA_ALPHA = 0.3;
/** Hysteresis margin above `floorDb` to open the level gate, avoiding chatter right at the threshold. */
const GATE_OPEN_MARGIN_DB = 10;
/**
 * YIN clarity threshold for "this is voiced speech, not noise." Chosen with margin above the
 * ~0.3-0.5 clarity white noise reports (see yin.test.ts) and below the >0.9 clean tones report.
 */
const CLARITY_OPEN = 0.6;
const CLARITY_CLOSE = 0.45;

/** How many voiced pitch samples to keep for the inflection (pitch-variability) statistic. */
const PITCH_HISTORY_LENGTH = 150;
const MIN_PITCH_HISTORY_FOR_STAT = 15;

/** Shorter, more "local" window for jitter/shimmer than inflection's — these are meant to
 *  reflect short-term perturbation, not a multi-second trend. */
const PERTURBATION_HISTORY_LENGTH = 30;
const MIN_PERTURBATION_HISTORY = 8;

export function hzToSemitones(hz: number): number {
  return 12 * Math.log2(hz / 440);
}

/**
 * Gates formant/pitch/ring-twang/CPP/HNR feedback on both signal level (vs the Floor setting)
 * and YIN periodicity (clarity) — level alone can't distinguish a quiet vowel from a loud,
 * steady hiss, but periodicity can: voice is quasi-periodic, broadband noise isn't. Smooths
 * across frames afterward since a single 10ms LPC/YIN/cepstrum fit is inherently noisy.
 */
export class FeedbackSmoother {
  private f1Ema: number | null = null;
  private f2Ema: number | null = null;
  private f3Ema: number | null = null;
  private pitchEma: number | null = null;
  private cppEma = 0;
  private hnrEma = 0;
  private ringEma = 0;
  private gateOpen = false;
  private pitchHistorySemitones: number[] = [];
  /** Raw (unsmoothed) consecutive voiced-frame periods/amplitudes, for jitter/shimmer. */
  private periodHistorySec: number[] = [];
  private amplitudeHistoryLinear: number[] = [];

  process(result: SpectrumResult, floorDb: number): SmoothedFeedback {
    let peakDb = -Infinity;
    for (let i = 0; i < result.magnitudes.length; i++) {
      const db = 20 * Math.log10(result.magnitudes[i] + 1e-12);
      if (db > peakDb) peakDb = db;
    }
    const levelOpen = peakDb > floorDb + GATE_OPEN_MARGIN_DB;
    const levelClose = peakDb < floorDb;

    const clarity = result.pitch?.clarity ?? 0;
    if (!this.gateOpen && levelOpen && clarity > CLARITY_OPEN) this.gateOpen = true;
    else if (this.gateOpen && (levelClose || clarity < CLARITY_CLOSE)) this.gateOpen = false;

    if (!this.gateOpen) {
      this.f1Ema = null;
      this.f2Ema = null;
      this.f3Ema = null;
      this.pitchEma = null;
      this.cppEma = 0;
      this.hnrEma = 0;
      this.ringEma = 0;
      this.periodHistorySec = [];
      this.amplitudeHistoryLinear = [];
      return {
        formants: [],
        ringTwangRatio: 0,
        pitchHz: null,
        cppDb: 0,
        hnrDb: 0,
        avgFormantHz: null,
        inflectionSemitones: this.inflectionStat(),
        jitterPercent: null,
        shimmerPercent: null,
        hasSignal: false,
      };
    }

    const f1Raw = result.formants[0]?.frequency;
    const f2Raw = result.formants[1]?.frequency;
    const f3Raw = result.formants[2]?.frequency;
    this.f1Ema = f1Raw === undefined ? this.f1Ema : this.ema(this.f1Ema, f1Raw);
    this.f2Ema = f2Raw === undefined ? this.f2Ema : this.ema(this.f2Ema, f2Raw);
    this.f3Ema = f3Raw === undefined ? this.f3Ema : this.ema(this.f3Ema, f3Raw);
    this.pitchEma = result.pitch ? this.ema(this.pitchEma, result.pitch.frequency) : this.pitchEma;
    this.cppEma = this.cppEma + EMA_ALPHA * (result.cppDb - this.cppEma);
    this.hnrEma = this.hnrEma + EMA_ALPHA * (result.hnrDb - this.hnrEma);
    this.ringEma = this.ringEma + EMA_ALPHA * (result.ringTwangRatio - this.ringEma);

    if (result.pitch) {
      this.pitchHistorySemitones.push(hzToSemitones(result.pitch.frequency));
      if (this.pitchHistorySemitones.length > PITCH_HISTORY_LENGTH) this.pitchHistorySemitones.shift();

      this.periodHistorySec.push(1 / result.pitch.frequency);
      if (this.periodHistorySec.length > PERTURBATION_HISTORY_LENGTH) this.periodHistorySec.shift();
    }
    const linearAmplitude = Math.pow(10, result.inputLevelDb / 20);
    this.amplitudeHistoryLinear.push(linearAmplitude);
    if (this.amplitudeHistoryLinear.length > PERTURBATION_HISTORY_LENGTH) this.amplitudeHistoryLinear.shift();

    const formants: Formant[] = [];
    if (this.f1Ema !== null) formants.push({ frequency: this.f1Ema, bandwidth: 0 });
    if (this.f2Ema !== null) formants.push({ frequency: this.f2Ema, bandwidth: 0 });
    if (this.f3Ema !== null) formants.push({ frequency: this.f3Ema, bandwidth: 0 });

    const present = [this.f1Ema, this.f2Ema, this.f3Ema].filter((v): v is number => v !== null);
    const avgFormantHz = present.length >= 2 ? present.reduce((a, b) => a + b, 0) / present.length : null;

    return {
      formants,
      ringTwangRatio: this.ringEma,
      pitchHz: this.pitchEma,
      cppDb: this.cppEma,
      hnrDb: this.hnrEma,
      avgFormantHz,
      inflectionSemitones: this.inflectionStat(),
      jitterPercent: this.averageRelativeDeltaPercent(this.periodHistorySec),
      shimmerPercent: this.averageRelativeDeltaPercent(this.amplitudeHistoryLinear),
      hasSignal: true,
    };
  }

  private inflectionStat(): number | null {
    const n = this.pitchHistorySemitones.length;
    if (n < MIN_PITCH_HISTORY_FOR_STAT) return null;
    const mean = this.pitchHistorySemitones.reduce((a, b) => a + b, 0) / n;
    const variance = this.pitchHistorySemitones.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    return Math.sqrt(variance);
  }

  /**
   * Mean absolute frame-to-frame difference as a percent of the mean value — the same shape as
   * clinical local jitter/shimmer formulas, but computed on ~10ms analysis frames rather than
   * true pitch-synchronous cycles (which would need individual glottal-period boundaries). It's
   * an approximate perturbation indicator, not a clinical jitter/shimmer measurement.
   */
  private averageRelativeDeltaPercent(values: number[]): number | null {
    const n = values.length;
    if (n < MIN_PERTURBATION_HISTORY) return null;
    let sumAbsDelta = 0;
    for (let i = 1; i < n; i++) sumAbsDelta += Math.abs(values[i] - values[i - 1]);
    const mean = values.reduce((a, b) => a + b, 0) / n;
    if (mean === 0) return null;
    return (sumAbsDelta / (n - 1) / mean) * 100;
  }

  reset(): void {
    this.f1Ema = null;
    this.f2Ema = null;
    this.f3Ema = null;
    this.pitchEma = null;
    this.cppEma = 0;
    this.hnrEma = 0;
    this.ringEma = 0;
    this.gateOpen = false;
    this.pitchHistorySemitones = [];
    this.periodHistorySec = [];
    this.amplitudeHistoryLinear = [];
  }

  private ema(previous: number | null, next: number): number {
    return previous === null ? next : previous + EMA_ALPHA * (next - previous);
  }
}
