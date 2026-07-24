import { drawSparkline } from "../render/sparkline.ts";
import { noteNameForFrequency } from "../render/frequency-axis.ts";
import { exportSessionAudio, exportSessionsAsCsv, exportSessionsAsJson } from "../storage/export.ts";
import { clearSessions, deleteSession, listSessions, type SessionSummary } from "../storage/sessions.ts";

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}

function formatWhen(epochMs: number): string {
  const d = new Date(epochMs);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function fmt(value: number | null, digits: number, unit: string): string {
  return value !== null ? `${value.toFixed(digits)}${unit}` : "--";
}

/** Custom Practice Cards are free-typed user text — never interpolate it into innerHTML unescaped. */
function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

/** Top vowels first, e.g. "/i/ 45%, /ɑ/ 20%, /u/ 15%". */
function formatVowelDistribution(dist: Record<string, number> | null): string {
  if (!dist) return "--";
  const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "--";
  return entries.map(([symbol, frac]) => `/${symbol}/ ${Math.round(frac * 100)}%`).join(", ");
}

/** Signed Hz distance from target — e.g. "-12 Hz below" / "+8 Hz above" / "in range". */
function formatTargetDistance(distanceHz: number | null): string {
  if (distanceHz === null) return "--";
  if (distanceHz === 0) return "in range";
  return distanceHz < 0 ? `${Math.round(-distanceHz)} Hz below` : `${Math.round(distanceHz)} Hz above`;
}

interface ComparisonRow {
  label: string;
  a: string;
  b: string;
}

function buildComparisonRows(a: SessionSummary, b: SessionSummary): ComparisonRow[] {
  return [
    { label: "Date", a: formatWhen(a.startedAt), b: formatWhen(b.startedAt) },
    { label: "Duration", a: formatDuration(a.durationMs), b: formatDuration(b.durationMs) },
    {
      label: "Avg pitch",
      a: a.avgPitchHz !== null ? `${Math.round(a.avgPitchHz)} Hz (${noteNameForFrequency(a.avgPitchHz)})` : "--",
      b: b.avgPitchHz !== null ? `${Math.round(b.avgPitchHz)} Hz (${noteNameForFrequency(b.avgPitchHz)})` : "--",
    },
    { label: "Pitch variation", a: fmt(a.pitchStddevSemitones, 1, " st"), b: fmt(b.pitchStddevSemitones, 1, " st") },
    { label: "Weight (CPP)", a: fmt(a.avgCppDb, 1, " dB"), b: fmt(b.avgCppDb, 1, " dB") },
    { label: "HNR", a: fmt(a.avgHnrDb, 1, " dB"), b: fmt(b.avgHnrDb, 1, " dB") },
    { label: "Jitter", a: fmt(a.avgJitterPercent, 2, "%"), b: fmt(b.avgJitterPercent, 2, "%") },
    { label: "Shimmer", a: fmt(a.avgShimmerPercent, 2, "%"), b: fmt(b.avgShimmerPercent, 2, "%") },
    { label: "Ring/Twang", a: fmt(a.avgRingTwangPct, 1, "%"), b: fmt(b.avgRingTwangPct, 1, "%") },
    { label: "F1", a: fmt(a.avgF1Hz, 0, " Hz"), b: fmt(b.avgF1Hz, 0, " Hz") },
    { label: "F2", a: fmt(a.avgF2Hz, 0, " Hz"), b: fmt(b.avgF2Hz, 0, " Hz") },
    { label: "F3", a: fmt(a.avgF3Hz, 0, " Hz"), b: fmt(b.avgF3Hz, 0, " Hz") },
    { label: "Avg formant", a: fmt(a.avgFormantHz, 0, " Hz"), b: fmt(b.avgFormantHz, 0, " Hz") },
    {
      label: "In target range",
      a: a.percentInTargetRange !== null ? `${Math.round(a.percentInTargetRange * 100)}%` : "--",
      b: b.percentInTargetRange !== null ? `${Math.round(b.percentInTargetRange * 100)}%` : "--",
    },
    { label: "Target distance", a: formatTargetDistance(a.avgTargetDistanceHz), b: formatTargetDistance(b.avgTargetDistanceHz) },
    {
      label: "Acoustic proximity — masculine",
      a: a.proximityMasculinePct !== null ? `${Math.round(a.proximityMasculinePct * 100)}%` : "--",
      b: b.proximityMasculinePct !== null ? `${Math.round(b.proximityMasculinePct * 100)}%` : "--",
    },
    {
      label: "Acoustic proximity — androgynous",
      a: a.proximityAndrogynousPct !== null ? `${Math.round(a.proximityAndrogynousPct * 100)}%` : "--",
      b: b.proximityAndrogynousPct !== null ? `${Math.round(b.proximityAndrogynousPct * 100)}%` : "--",
    },
    {
      label: "Acoustic proximity — feminine",
      a: a.proximityFemininePct !== null ? `${Math.round(a.proximityFemininePct * 100)}%` : "--",
      b: b.proximityFemininePct !== null ? `${Math.round(b.proximityFemininePct * 100)}%` : "--",
    },
  ];
}

function buildMoreStatsRows(a: SessionSummary, b: SessionSummary): ComparisonRow[] {
  return [
    {
      label: "Clipped frames",
      a: a.percentClipped !== null ? `${Math.round(a.percentClipped * 100)}%` : "--",
      b: b.percentClipped !== null ? `${Math.round(b.percentClipped * 100)}%` : "--",
    },
    { label: "Vowel mix", a: formatVowelDistribution(a.vowelDistribution), b: formatVowelDistribution(b.vowelDistribution) },
    {
      label: "Avg ΔF2 vs /i/ anchor",
      a: a.avgDeltaF2FromAnchor !== null ? `${Math.round(a.avgDeltaF2FromAnchor)} Hz` : "--",
      b: b.avgDeltaF2FromAnchor !== null ? `${Math.round(b.avgDeltaF2FromAnchor)} Hz` : "--",
    },
  ];
}

export interface SessionsPanelCallbacks {
  onPlay: (session: SessionSummary) => void;
  onImportAudio: (file: File) => void;
}

export class SessionsPanel {
  private sessions: SessionSummary[] = [];
  private readonly selectedIds = new Set<number>();
  private comparing: [SessionSummary, SessionSummary] | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: SessionsPanelCallbacks,
  ) {}

  async refresh(): Promise<void> {
    this.sessions = await listSessions();
    this.render();
  }

  private render(): void {
    const { container, sessions } = this;
    container.innerHTML = "";

    const header = document.createElement("div");
    header.className = "sessions-header";
    const trendCanvas = document.createElement("canvas");
    trendCanvas.className = "sessions-trend";
    trendCanvas.width = 240;
    trendCanvas.height = 40;
    header.innerHTML = `<span class="settings-subhead">Pitch trend (avg Hz per session, oldest &rarr; newest)</span>`;
    header.appendChild(trendCanvas);
    container.appendChild(header);

    const trendValues = [...sessions]
      .reverse()
      .map((s) => s.avgPitchHz)
      .filter((v): v is number => v !== null);
    if (trendValues.length >= 2) drawSparkline(trendCanvas, trendValues, { color: "#5bcefa" });

    const toolbar = document.createElement("div");
    toolbar.className = "sessions-toolbar";

    const exportJsonBtn = document.createElement("button");
    exportJsonBtn.type = "button";
    exportJsonBtn.textContent = "Export JSON";
    exportJsonBtn.disabled = sessions.length === 0;
    exportJsonBtn.addEventListener("click", () => exportSessionsAsJson(sessions));
    toolbar.appendChild(exportJsonBtn);

    const exportCsvBtn = document.createElement("button");
    exportCsvBtn.type = "button";
    exportCsvBtn.textContent = "Export CSV";
    exportCsvBtn.disabled = sessions.length === 0;
    exportCsvBtn.addEventListener("click", () => exportSessionsAsCsv(sessions));
    toolbar.appendChild(exportCsvBtn);

    const importBtn = document.createElement("button");
    importBtn.type = "button";
    importBtn.textContent = "Import audio";
    const importInput = document.createElement("input");
    importInput.type = "file";
    importInput.accept = "audio/*";
    importInput.hidden = true;
    importBtn.addEventListener("click", () => importInput.click());
    importInput.addEventListener("change", () => {
      const file = importInput.files?.[0];
      importInput.value = ""; // reset so re-selecting the same file still fires "change"
      if (file) this.callbacks.onImportAudio(file);
    });
    toolbar.appendChild(importBtn);
    toolbar.appendChild(importInput);

    const compareBtn = document.createElement("button");
    compareBtn.type = "button";
    compareBtn.textContent = `Compare Selected (${this.selectedIds.size}/2)`;
    compareBtn.disabled = this.selectedIds.size !== 2;
    compareBtn.addEventListener("click", () => {
      const [idA, idB] = [...this.selectedIds];
      const a = sessions.find((s) => s.id === idA);
      const b = sessions.find((s) => s.id === idB);
      if (a && b) {
        this.comparing = [a, b];
        this.render();
      }
    });
    toolbar.appendChild(compareBtn);

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.textContent = "Clear all history";
    clearBtn.addEventListener("click", async () => {
      if (!confirm("Delete all saved sessions? This can't be undone.")) return;
      if (!(await clearSessions())) {
        alert("Couldn't clear history — see the console for details.");
        return;
      }
      this.selectedIds.clear();
      this.comparing = null;
      await this.refresh();
    });
    toolbar.appendChild(clearBtn);
    container.appendChild(toolbar);

    if (this.comparing) {
      container.appendChild(this.renderComparison(this.comparing[0], this.comparing[1]));
    }

    if (sessions.length === 0) {
      const empty = document.createElement("p");
      empty.className = "settings-note";
      empty.textContent = "No sessions recorded yet. Start capturing, then Stop, to log one.";
      container.appendChild(empty);
      return;
    }

    const list = document.createElement("div");
    list.className = "sessions-list";
    for (const session of sessions) {
      list.appendChild(this.renderRow(session));
    }
    container.appendChild(list);
  }

  private renderComparison(a: SessionSummary, b: SessionSummary): HTMLElement {
    const section = document.createElement("div");
    section.className = "comparison-panel";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "Close comparison";
    closeBtn.addEventListener("click", () => {
      this.comparing = null;
      this.render();
    });

    const table = document.createElement("table");
    table.className = "comparison-table";
    table.innerHTML = `
      <thead><tr><th></th><th>${formatWhen(a.startedAt)}</th><th>${formatWhen(b.startedAt)}</th></tr></thead>
      <tbody>
        ${buildComparisonRows(a, b)
          .map((row) => `<tr><td>${row.label}</td><td>${row.a}</td><td>${row.b}</td></tr>`)
          .join("")}
      </tbody>
    `;
    section.appendChild(table);

    const moreStats = document.createElement("details");
    moreStats.className = "session-more-stats";
    moreStats.innerHTML = `
      <summary>More stats</summary>
      <table class="comparison-table">
        <thead><tr><th></th><th>${formatWhen(a.startedAt)}</th><th>${formatWhen(b.startedAt)}</th></tr></thead>
        <tbody>
          ${buildMoreStatsRows(a, b)
            .map((row) => `<tr><td>${row.label}</td><td>${row.a}</td><td>${row.b}</td></tr>`)
            .join("")}
        </tbody>
      </table>
    `;
    section.appendChild(moreStats);

    section.appendChild(closeBtn);
    return section;
  }

  private renderRow(session: SessionSummary): HTMLElement {
    const row = document.createElement("div");
    row.className = "session-row";

    const meta = document.createElement("div");
    meta.className = "session-meta";
    const title = session.exerciseId ? `Exercise: ${session.exerciseId}` : "Free session";
    const pitchStr =
      session.avgPitchHz !== null
        ? `${Math.round(session.avgPitchHz)} Hz (${noteNameForFrequency(session.avgPitchHz)})`
        : "no voiced pitch";
    const cppStr = session.avgCppDb !== null ? `${session.avgCppDb.toFixed(1)} dB weight` : "";
    const hnrStr = session.avgHnrDb !== null ? `${session.avgHnrDb.toFixed(1)} dB HNR` : "";
    const targetStr =
      session.percentInTargetRange !== null
        ? `${Math.round(session.percentInTargetRange * 100)}% in target (${formatTargetDistance(session.avgTargetDistanceHz)})`
        : "";
    const proximityStr =
      session.proximityMasculinePct !== null && session.proximityAndrogynousPct !== null && session.proximityFemininePct !== null
        ? `acoustic proximity — M ${Math.round(session.proximityMasculinePct * 100)}% / A ${Math.round(session.proximityAndrogynousPct * 100)}% / F ${Math.round(session.proximityFemininePct * 100)}%`
        : "";
    const cardLine = session.cardText
      ? `<div class="session-card-text">Card: &ldquo;${escapeHtml(session.cardText)}&rdquo;</div>`
      : "";
    const clippedStr = session.percentClipped !== null ? `${Math.round(session.percentClipped * 100)}%` : "--";
    const anchorStr = session.avgDeltaF2FromAnchor !== null ? `${Math.round(session.avgDeltaF2FromAnchor)} Hz` : "--";
    meta.innerHTML = `
      <strong>${title}</strong> &middot; ${formatWhen(session.startedAt)} &middot; ${formatDuration(session.durationMs)}
      <div class="session-metrics">${[pitchStr, cppStr, hnrStr, targetStr, proximityStr].filter(Boolean).join(" &middot; ")}</div>
      ${cardLine}
      <details class="session-more-stats">
        <summary>More stats</summary>
        <div class="session-more-stats-body">
          <div>Clipped frames: ${clippedStr}</div>
          <div>Vowel mix: ${formatVowelDistribution(session.vowelDistribution)}</div>
          <div>Avg &Delta;F2 vs /i/ anchor: ${anchorStr}</div>
        </div>
      </details>
    `;
    row.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "session-actions";

    if (session.id !== undefined) {
      const id = session.id;
      const compareLabel = document.createElement("label");
      compareLabel.className = "session-compare-check";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = this.selectedIds.has(id);
      checkbox.title = "Select for comparison";
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          if (this.selectedIds.size >= 2) {
            checkbox.checked = false;
            return;
          }
          this.selectedIds.add(id);
        } else {
          this.selectedIds.delete(id);
        }
        this.render();
      });
      compareLabel.appendChild(checkbox);
      compareLabel.append("Compare");
      actions.appendChild(compareLabel);
    }

    if (session.audioBlob) {
      const playBtn = document.createElement("button");
      playBtn.type = "button";
      playBtn.textContent = "Play";
      playBtn.addEventListener("click", () => this.callbacks.onPlay(session));
      actions.appendChild(playBtn);

      const downloadBtn = document.createElement("button");
      downloadBtn.type = "button";
      downloadBtn.textContent = "Download";
      downloadBtn.addEventListener("click", () => exportSessionAudio(session));
      actions.appendChild(downloadBtn);
    }
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async () => {
      if (session.id === undefined) return;
      if (!(await deleteSession(session.id))) {
        alert("Couldn't delete this session — see the console for details.");
        return;
      }
      this.selectedIds.delete(session.id);
      await this.refresh();
    });
    actions.appendChild(deleteBtn);
    row.appendChild(actions);

    return row;
  }
}
