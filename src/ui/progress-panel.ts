import { drawSparkline } from "../render/sparkline.ts";
import { goldAccent } from "../render/theme.ts";
import { buildTrend, computeDailyMinutes, computeStreakDays, minutesToday } from "../state/progress.ts";
import type { ViewSettings } from "../state/view-settings.ts";
import { listSessions, type SessionSummary } from "../storage/sessions.ts";

interface TrendMetric {
  key: keyof SessionSummary;
  label: string;
  /** A function, not a plain string — goldAccent() depends on the *current* theme, so it must be
   *  re-resolved every render rather than baked in once when this module first loads. */
  color: () => string;
  min?: number;
}

const TREND_METRICS: TrendMetric[] = [
  { key: "avgPitchHz", label: "Avg Pitch (Hz)", color: () => "#5bcefa" },
  { key: "pitchStddevSemitones", label: "Inflection (semitones)", color: () => "#f5a9b8", min: 0 },
  { key: "avgCppDb", label: "Weight / CPP (dB)", color: goldAccent },
  { key: "avgHnrDb", label: "HNR (dB)", color: () => "#5bcefa" },
  { key: "avgJitterPercent", label: "Jitter (%)", color: () => "#f5a9b8", min: 0 },
  { key: "avgShimmerPercent", label: "Shimmer (%)", color: goldAccent, min: 0 },
  { key: "avgRingTwangPct", label: "Ring/Twang (%)", color: () => "#5bcefa", min: 0 },
  { key: "avgF1Hz", label: "F1 (Hz)", color: () => "#f5a9b8" },
  { key: "avgF2Hz", label: "F2 (Hz)", color: goldAccent },
  { key: "avgF3Hz", label: "F3 (Hz)", color: () => "#5bcefa" },
  { key: "avgFormantHz", label: "Avg Formant (Hz)", color: () => "#f5a9b8" },
  { key: "percentInTargetRange", label: "In Target Range (%)", color: () => "#5bcefa", min: 0 },
  { key: "avgTargetDistanceHz", label: "Target Distance (Hz, signed)", color: () => "#f5a9b8" },
  { key: "proximityMasculinePct", label: "Acoustic Proximity — Masculine (%)", color: () => "#5bcefa", min: 0 },
  { key: "proximityAndrogynousPct", label: "Acoustic Proximity — Androgynous (%)", color: goldAccent, min: 0 },
  { key: "proximityFemininePct", label: "Acoustic Proximity — Feminine (%)", color: () => "#f5a9b8", min: 0 },
];

/** Less commonly needed — data-quality/reliability flags rather than voice-quality metrics — so
 *  they're bundled under a collapsible "More stats" section instead of the always-visible list. */
const MORE_TREND_METRICS: TrendMetric[] = [
  { key: "percentClipped", label: "Clipped Frames (%)", color: () => "#ff4d4d", min: 0 },
  { key: "avgDeltaF2FromAnchor", label: "Avg ΔF2 vs /i/ Anchor (Hz)", color: () => "#f5a9b8", min: 0 },
];

/**
 * Note in the copy below is deliberate: this can only ever show goal progress WHILE the app is
 * open. A true background reminder (notify the user even when they haven't opened the app) needs
 * a server to wake them up, which is out of scope for this client-only app — so this is a
 * visibility dashboard, not a push-notification system, and says so rather than implying more.
 */
export class ProgressPanel {
  constructor(
    private readonly container: HTMLElement,
    private readonly settings: ViewSettings,
  ) {}

  async refresh(): Promise<void> {
    const sessions = await listSessions();
    this.render(sessions);
  }

  private render(sessions: SessionSummary[]): void {
    const { container, settings } = this;
    container.innerHTML = "";

    const dailyMinutes = computeDailyMinutes(sessions);
    const now = Date.now();
    const today = minutesToday(dailyMinutes, now);
    const streak = computeStreakDays(dailyMinutes, now);

    const goalSection = document.createElement("div");
    goalSection.className = "settings-group";
    const goalHeading = document.createElement("h3");
    goalHeading.className = "settings-subhead";
    goalHeading.textContent = "Daily goal & streak";
    goalSection.appendChild(goalHeading);

    const note = document.createElement("p");
    note.className = "settings-note";
    note.textContent =
      "Shown whenever you open the app — there's no background/push reminder here, since that would need a server to wake you up, which this app deliberately doesn't have.";
    goalSection.appendChild(note);

    const goalRow = document.createElement("div");
    goalRow.className = "settings-row";
    const goalLabel = document.createElement("span");
    goalLabel.textContent = "Goal (minutes/day)";
    const goalInput = document.createElement("input");
    goalInput.type = "number";
    goalInput.min = "0";
    goalInput.style.width = "4.5rem";
    goalInput.value = settings.dailyGoalMinutes !== null ? String(settings.dailyGoalMinutes) : "";
    goalInput.placeholder = "off";
    goalInput.addEventListener("change", () => {
      const n = Number(goalInput.value);
      settings.dailyGoalMinutes = goalInput.value !== "" && n > 0 ? n : null;
      this.render(sessions);
    });
    goalRow.append(goalLabel, goalInput);
    goalSection.appendChild(goalRow);

    const status = document.createElement("p");
    status.className = "settings-note";
    const todayStr = `${today.toFixed(1)} min practiced today`;
    const goalStr =
      settings.dailyGoalMinutes !== null
        ? ` of your ${settings.dailyGoalMinutes} min goal (${today >= settings.dailyGoalMinutes ? "met! 🎉" : "not yet met"})`
        : "";
    status.textContent = `${todayStr}${goalStr}. Current streak: ${streak} day${streak === 1 ? "" : "s"}.`;
    goalSection.appendChild(status);

    container.appendChild(goalSection);

    if (sessions.length < 2) {
      const empty = document.createElement("p");
      empty.className = "settings-note";
      empty.textContent = "Trends need at least 2 saved sessions to plot — keep practicing to see them here.";
      container.appendChild(empty);
      return;
    }

    const trendsSection = document.createElement("div");
    trendsSection.className = "settings-group";
    const trendsHeading = document.createElement("h3");
    trendsHeading.className = "settings-subhead";
    trendsHeading.textContent = "Trends across all sessions (oldest → newest)";
    trendsSection.appendChild(trendsHeading);
    this.renderTrendRows(trendsSection, sessions, TREND_METRICS);
    container.appendChild(trendsSection);

    const moreDetails = document.createElement("details");
    moreDetails.className = "session-more-stats";
    const summary = document.createElement("summary");
    summary.textContent = "More stats";
    moreDetails.appendChild(summary);
    this.renderTrendRows(moreDetails, sessions, MORE_TREND_METRICS);
    container.appendChild(moreDetails);
  }

  private renderTrendRows(parent: HTMLElement, sessions: SessionSummary[], metrics: TrendMetric[]): void {
    for (const metric of metrics) {
      const trend = buildTrend(sessions, metric.key);
      if (trend.length < 2) continue;
      const row = document.createElement("div");
      row.className = "progress-trend-row";
      const label = document.createElement("span");
      label.className = "hud-label";
      label.textContent = metric.label;
      const canvas = document.createElement("canvas");
      canvas.className = "sessions-trend";
      canvas.width = 400;
      canvas.height = 40;
      row.append(label, canvas);
      parent.appendChild(row);
      drawSparkline(
        canvas,
        trend.map((p) => p.value),
        { color: metric.color(), min: metric.min },
      );
    }
  }
}
