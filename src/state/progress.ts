import type { SessionSummary } from "../storage/sessions.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

function dateKey(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Sums practiced minutes per calendar day (local time), keyed "YYYY-MM-DD". */
export function computeDailyMinutes(sessions: SessionSummary[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const session of sessions) {
    const key = dateKey(session.startedAt);
    totals.set(key, (totals.get(key) ?? 0) + session.durationMs / 60000);
  }
  return totals;
}

export function minutesToday(dailyMinutes: Map<string, number>, now: number): number {
  return dailyMinutes.get(dateKey(now)) ?? 0;
}

/**
 * Consecutive calendar days with at least one logged session, walking backward from today.
 * Today itself doesn't have to have a session yet to keep yesterday's streak alive — it only
 * breaks once a full day passes with nothing logged.
 */
export function computeStreakDays(dailyMinutes: Map<string, number>, now: number): number {
  const todayKey = dateKey(now);
  let cursor = now;
  if (!dailyMinutes.has(todayKey)) cursor -= DAY_MS; // today's empty, but that alone doesn't break it

  let streak = 0;
  while (dailyMinutes.has(dateKey(cursor))) {
    streak++;
    cursor -= DAY_MS;
  }
  return streak;
}

export interface TrendPoint {
  value: number;
  startedAt: number;
}

/** Oldest-to-newest series of one metric across every session that has a non-null value for it. */
export function buildTrend(sessions: SessionSummary[], metric: keyof SessionSummary): TrendPoint[] {
  return [...sessions]
    .sort((a, b) => a.startedAt - b.startedAt)
    .filter((s) => typeof s[metric] === "number")
    .map((s) => ({ value: s[metric] as number, startedAt: s.startedAt }));
}
