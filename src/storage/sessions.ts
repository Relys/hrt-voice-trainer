import { dbAdd, dbClear, dbDelete, dbGetAll, SESSIONS_STORE } from "./db.ts";
import type { TargetRangePreset } from "../state/view-settings.ts";

export interface SessionSummary {
  id?: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  frameCount: number;
  voicedFrameCount: number;
  avgPitchHz: number | null;
  pitchStddevSemitones: number | null;
  avgCppDb: number | null;
  avgRingTwangPct: number | null;
  avgF1Hz: number | null;
  avgF2Hz: number | null;
  avgF3Hz: number | null;
  avgFormantHz: number | null;
  avgHnrDb: number | null;
  avgJitterPercent: number | null;
  avgShimmerPercent: number | null;
  targetRangePreset: TargetRangePreset;
  targetRangeHz: [number, number] | null;
  /** Fraction (0-1) of voiced frames whose pitch fell within targetRangeHz; null if no target was set. */
  percentInTargetRange: number | null;
  /** Mean signed Hz distance from the target band (negative=below, positive=above, 0=inside);
   *  a companion to percentInTargetRange showing direction/magnitude, not just hit/miss. */
  avgTargetDistanceHz: number | null;
  /** Mean Acoustic Proximity value (0-1) across the session — see state/acoustic-proximity.ts. */
  avgAcousticProximity: number | null;
  /** Fractions (0-1) of counted frames in each proximity category; null if none were countable. */
  proximityMasculinePct: number | null;
  proximityAndrogynousPct: number | null;
  proximityFemininePct: number | null;
  /** Fraction (0-1) of ALL frames (voiced or not) whose input clipped — a data-quality/reliability
   *  flag, distinct from the voice-quality metrics above. */
  percentClipped: number | null;
  /** Fraction (0-1) of vowel-classified frames landing on each vowel symbol (e.g. "i", "ɑ"); null
   *  if none were classified this session. */
  vowelDistribution: Record<string, number> | null;
  /** Mean |F2 - iAnchorF2| in Hz, only over frames where an /i/-anchor was set; null otherwise. */
  avgDeltaF2FromAnchor: number | null;
  /** Recorded audio for this session, if recording was enabled. */
  audioBlob: Blob | null;
  audioMimeType: string | null;
  exerciseId: string | null;
  /** Which Practice Card (if any) was active during this session — id for reference, text
   *  snapshotted directly so history stays meaningful even if a custom card is later deleted. */
  cardId: string | null;
  cardText: string | null;
}

/**
 * Returns true on success. IndexedDB can genuinely fail — Safari private browsing has
 * historically blocked it outright, and quota can be exceeded — so every call here is a soft
 * failure: log and report false rather than letting an unhandled rejection reach the caller.
 */
export async function saveSession(summary: SessionSummary): Promise<boolean> {
  try {
    await dbAdd(SESSIONS_STORE, summary);
    return true;
  } catch (err) {
    console.warn("Couldn't save session to history:", err);
    return false;
  }
}

export async function listSessions(): Promise<SessionSummary[]> {
  try {
    const sessions = await dbGetAll<SessionSummary>(SESSIONS_STORE);
    return sessions.sort((a, b) => b.startedAt - a.startedAt);
  } catch (err) {
    console.warn("Couldn't load session history:", err);
    return [];
  }
}

export async function deleteSession(id: number): Promise<boolean> {
  try {
    await dbDelete(SESSIONS_STORE, id);
    return true;
  } catch (err) {
    console.warn("Couldn't delete session:", err);
    return false;
  }
}

export async function clearSessions(): Promise<boolean> {
  try {
    await dbClear(SESSIONS_STORE);
    return true;
  } catch (err) {
    console.warn("Couldn't clear session history:", err);
    return false;
  }
}
