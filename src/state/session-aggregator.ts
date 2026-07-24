import { computeAcousticProximity } from "./acoustic-proximity.ts";
import { classifyVowel } from "../dsp/vowel.ts";
import { hzToSemitones } from "./feedback-smoother.ts";
import type { SmoothedFeedback } from "./feedback-smoother.ts";
import type { SessionSummary } from "../storage/sessions.ts";
import { targetDistanceHz, type TargetRangePreset } from "./view-settings.ts";

interface RunningStat {
  sum: number;
  count: number;
}

function addStat(stat: RunningStat, value: number): void {
  stat.sum += value;
  stat.count += 1;
}

function meanOf(stat: RunningStat): number | null {
  return stat.count > 0 ? stat.sum / stat.count : null;
}

/**
 * Accumulates per-frame smoothed feedback over a capture session (or a single exercise
 * window) into running sums, then produces a single summary record on `finalize()`.
 */
export class SessionAggregator {
  private frameCount = 0;
  private voicedFrameCount = 0;
  private inTargetCount = 0;
  private pitch: RunningStat = { sum: 0, count: 0 };
  private pitchSemitones: number[] = [];
  private cpp: RunningStat = { sum: 0, count: 0 };
  private hnr: RunningStat = { sum: 0, count: 0 };
  private ring: RunningStat = { sum: 0, count: 0 };
  private f1: RunningStat = { sum: 0, count: 0 };
  private f2: RunningStat = { sum: 0, count: 0 };
  private f3: RunningStat = { sum: 0, count: 0 };
  private avgFormant: RunningStat = { sum: 0, count: 0 };
  private jitter: RunningStat = { sum: 0, count: 0 };
  private shimmer: RunningStat = { sum: 0, count: 0 };
  private proximity: RunningStat = { sum: 0, count: 0 };
  private proximityMascCount = 0;
  private proximityAndroCount = 0;
  private proximityFemCount = 0;
  private clippedFrameCount = 0;
  private vowelCounts: Record<string, number> = {};
  private vowelFrameCount = 0;
  private deltaF2FromAnchor: RunningStat = { sum: 0, count: 0 };
  private targetDistance: RunningStat = { sum: 0, count: 0 };

  addFrame(
    smoothed: SmoothedFeedback,
    targetRangeHz: [number, number] | null,
    frameContext: { clipping: boolean; iAnchorF2: number | null },
  ): void {
    this.frameCount++;
    if (frameContext.clipping) this.clippedFrameCount++;
    if (!smoothed.hasSignal) return;
    this.voicedFrameCount++;

    if (smoothed.pitchHz !== null) {
      addStat(this.pitch, smoothed.pitchHz);
      this.pitchSemitones.push(hzToSemitones(smoothed.pitchHz));
      if (targetRangeHz && smoothed.pitchHz >= targetRangeHz[0] && smoothed.pitchHz <= targetRangeHz[1]) {
        this.inTargetCount++;
      }
      const distance = targetDistanceHz(smoothed.pitchHz, targetRangeHz);
      if (distance !== null) addStat(this.targetDistance, distance);
    }
    addStat(this.cpp, smoothed.cppDb);
    addStat(this.hnr, smoothed.hnrDb);
    addStat(this.ring, smoothed.ringTwangRatio * 100);
    const f1 = smoothed.formants[0]?.frequency ?? null;
    const f2 = smoothed.formants[1]?.frequency ?? null;
    if (f1 !== null) addStat(this.f1, f1);
    if (f2 !== null) addStat(this.f2, f2);
    if (smoothed.formants[2]) addStat(this.f3, smoothed.formants[2].frequency);
    if (smoothed.avgFormantHz !== null) addStat(this.avgFormant, smoothed.avgFormantHz);
    if (smoothed.jitterPercent !== null) addStat(this.jitter, smoothed.jitterPercent);
    if (smoothed.shimmerPercent !== null) addStat(this.shimmer, smoothed.shimmerPercent);

    const proximity = computeAcousticProximity(smoothed.pitchHz, f1, f2);
    if (proximity) {
      addStat(this.proximity, proximity.value);
      if (proximity.category === "masculine") this.proximityMascCount++;
      else if (proximity.category === "feminine") this.proximityFemCount++;
      else this.proximityAndroCount++;
    }

    if (f1 !== null && f2 !== null) {
      const vowel = classifyVowel(f1, f2);
      if (vowel) {
        this.vowelCounts[vowel.symbol] = (this.vowelCounts[vowel.symbol] ?? 0) + 1;
        this.vowelFrameCount++;
      }
    }
    if (frameContext.iAnchorF2 !== null && f2 !== null) {
      addStat(this.deltaF2FromAnchor, Math.abs(f2 - frameContext.iAnchorF2));
    }
  }

  private pitchStddevSemitones(): number | null {
    const n = this.pitchSemitones.length;
    if (n < 2) return null;
    const mean = this.pitchSemitones.reduce((a, b) => a + b, 0) / n;
    const variance = this.pitchSemitones.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    return Math.sqrt(variance);
  }

  private buildVowelDistribution(): Record<string, number> {
    const dist: Record<string, number> = {};
    for (const [symbol, count] of Object.entries(this.vowelCounts)) {
      dist[symbol] = count / this.vowelFrameCount;
    }
    return dist;
  }

  finalize(opts: {
    startedAt: number;
    endedAt: number;
    targetRangePreset: TargetRangePreset;
    targetRangeHz: [number, number] | null;
    audioBlob: Blob | null;
    audioMimeType: string | null;
    exerciseId: string | null;
    cardId?: string | null;
    cardText?: string | null;
  }): SessionSummary {
    return {
      startedAt: opts.startedAt,
      endedAt: opts.endedAt,
      durationMs: opts.endedAt - opts.startedAt,
      frameCount: this.frameCount,
      voicedFrameCount: this.voicedFrameCount,
      avgPitchHz: meanOf(this.pitch),
      pitchStddevSemitones: this.pitchStddevSemitones(),
      avgCppDb: meanOf(this.cpp),
      avgRingTwangPct: meanOf(this.ring),
      avgF1Hz: meanOf(this.f1),
      avgF2Hz: meanOf(this.f2),
      avgF3Hz: meanOf(this.f3),
      avgFormantHz: meanOf(this.avgFormant),
      avgHnrDb: meanOf(this.hnr),
      avgJitterPercent: meanOf(this.jitter),
      avgShimmerPercent: meanOf(this.shimmer),
      targetRangePreset: opts.targetRangePreset,
      targetRangeHz: opts.targetRangeHz,
      percentInTargetRange: opts.targetRangeHz && this.pitch.count > 0 ? this.inTargetCount / this.pitch.count : null,
      avgTargetDistanceHz: meanOf(this.targetDistance),
      avgAcousticProximity: meanOf(this.proximity),
      proximityMasculinePct: this.proximity.count > 0 ? this.proximityMascCount / this.proximity.count : null,
      proximityAndrogynousPct: this.proximity.count > 0 ? this.proximityAndroCount / this.proximity.count : null,
      proximityFemininePct: this.proximity.count > 0 ? this.proximityFemCount / this.proximity.count : null,
      percentClipped: this.frameCount > 0 ? this.clippedFrameCount / this.frameCount : null,
      vowelDistribution: this.vowelFrameCount > 0 ? this.buildVowelDistribution() : null,
      avgDeltaF2FromAnchor: meanOf(this.deltaF2FromAnchor),
      audioBlob: opts.audioBlob,
      audioMimeType: opts.audioMimeType,
      exerciseId: opts.exerciseId,
      cardId: opts.cardId ?? null,
      cardText: opts.cardText ?? null,
    };
  }

  reset(): void {
    this.frameCount = 0;
    this.voicedFrameCount = 0;
    this.inTargetCount = 0;
    this.pitch = { sum: 0, count: 0 };
    this.pitchSemitones = [];
    this.cpp = { sum: 0, count: 0 };
    this.hnr = { sum: 0, count: 0 };
    this.ring = { sum: 0, count: 0 };
    this.f1 = { sum: 0, count: 0 };
    this.f2 = { sum: 0, count: 0 };
    this.f3 = { sum: 0, count: 0 };
    this.avgFormant = { sum: 0, count: 0 };
    this.jitter = { sum: 0, count: 0 };
    this.shimmer = { sum: 0, count: 0 };
    this.proximity = { sum: 0, count: 0 };
    this.proximityMascCount = 0;
    this.proximityAndroCount = 0;
    this.proximityFemCount = 0;
    this.clippedFrameCount = 0;
    this.vowelCounts = {};
    this.vowelFrameCount = 0;
    this.deltaF2FromAnchor = { sum: 0, count: 0 };
    this.targetDistance = { sum: 0, count: 0 };
  }
}
