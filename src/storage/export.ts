import type { SessionSummary } from "./sessions.ts";

function downloadUrl(filename: string, url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function triggerDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  downloadUrl(filename, url);
  URL.revokeObjectURL(url);
}

function triggerBlobDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  downloadUrl(filename, url);
  URL.revokeObjectURL(url);
}

function extensionForMimeType(mimeType: string | null): string {
  if (mimeType?.includes("mp4")) return "m4a";
  if (mimeType?.includes("ogg")) return "ogg";
  return "webm";
}

/** Downloads a single session's raw recording, named/extensioned from its stored mime type. */
export function exportSessionAudio(session: SessionSummary): void {
  if (!session.audioBlob) return;
  const ext = extensionForMimeType(session.audioMimeType);
  triggerBlobDownload(`voice-trainer-session-${session.startedAt}.${ext}`, session.audioBlob);
}

/** Everything except the audio blob itself — that's excluded from exports (large, and binary). */
const EXPORT_FIELDS = [
  "startedAt",
  "endedAt",
  "durationMs",
  "frameCount",
  "voicedFrameCount",
  "avgPitchHz",
  "pitchStddevSemitones",
  "avgCppDb",
  "avgHnrDb",
  "avgJitterPercent",
  "avgShimmerPercent",
  "avgRingTwangPct",
  "avgF1Hz",
  "avgF2Hz",
  "avgF3Hz",
  "avgFormantHz",
  "targetRangePreset",
  "percentInTargetRange",
  "avgTargetDistanceHz",
  "avgAcousticProximity",
  "proximityMasculinePct",
  "proximityAndrogynousPct",
  "proximityFemininePct",
  "percentClipped",
  "vowelDistribution",
  "avgDeltaF2FromAnchor",
  "exerciseId",
  "cardText",
] as const satisfies ReadonlyArray<keyof SessionSummary>;

function toPlainRecord(session: SessionSummary): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const field of EXPORT_FIELDS) record[field] = session[field];
  record.startedAtIso = new Date(session.startedAt).toISOString();
  record.hasRecording = session.audioBlob !== null;
  return record;
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  // vowelDistribution is a nested object (e.g. {"i": 0.4, "ɑ": 0.2}) — JSON-encode it rather than
  // letting it stringify to the useless "[object Object]".
  const str = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportSessionsAsJson(sessions: SessionSummary[]): void {
  const records = sessions.map(toPlainRecord);
  triggerDownload(`voice-trainer-sessions-${Date.now()}.json`, JSON.stringify(records, null, 2), "application/json");
}

export function exportSessionsAsCsv(sessions: SessionSummary[]): void {
  const headers = [...EXPORT_FIELDS, "startedAtIso", "hasRecording"];
  const rows = sessions.map(toPlainRecord);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  triggerDownload(`voice-trainer-sessions-${Date.now()}.csv`, lines.join("\n"), "text/csv");
}
