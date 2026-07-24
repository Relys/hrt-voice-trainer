import { drawPieChart } from "../render/pie-chart.ts";
import { drawColorCodedSparkline, lerpHexColor } from "../render/sparkline.ts";
import { computeAcousticProximity, type ProximityCategory } from "../state/acoustic-proximity.ts";
import { MetricHistory } from "../state/metric-history.ts";
import type { TargetRangePreset } from "../state/view-settings.ts";

const HISTORY_LENGTH = 300; // ~a few seconds at live frame rate — a short rolling trend, not full history
const MASC_COLOR = "#5bcefa";
const FEM_COLOR = "#f5a9b8";
const ANDRO_COLOR = "#ffe9a8";

const INFO_TEXT =
  'Averages up to two independent 0-1 sub-scores &mdash; your live pitch\'s position between the masculine- and feminine-typical band midpoints, and your F1/F2 position projected against the same masculine/feminine corner-vowel reference clusters used by the Vowel Chart\'s "M/F clusters" mode (Peterson &amp; Barney 1952 / Hillenbrand et al. 1995) &mdash; then breaks that single position into three percentages (masculine/androgynous/feminine) that always add up to 100%, using a standard triangular-membership split rather than one ambiguous number. Androgynous is the midpoint between the two published clusters, not a separate published data point. If you have a Target range set in Settings, that category is marked with a target icon. This is a measure of acoustic similarity to reference points &mdash; NOT a prediction of perceived gender or "passing," which depends heavily on prosody, word choice, and social context that this can\'t capture. "Confidence" is how closely the pitch-based and formant-based sub-scores agree with each other (not a model\'s confidence in a prediction) &mdash; it only shows when both cues are available in the same frame.';

const CATEGORIES: Array<{ key: ProximityCategory; label: string }> = [
  { key: "masculine", label: "Masculine" },
  { key: "androgynous", label: "Androgynous" },
  { key: "feminine", label: "Feminine" },
];

function categoryColor(key: ProximityCategory): string {
  if (key === "masculine") return MASC_COLOR;
  if (key === "feminine") return FEM_COLOR;
  return ANDRO_COLOR;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec}s`;
}

/** Maps the settings target-range preset onto a proximity category; "off"/"custom" don't map cleanly. */
function targetAsCategory(preset: TargetRangePreset): ProximityCategory | null {
  if (preset === "masculine" || preset === "androgynous" || preset === "feminine") return preset;
  return null;
}

interface PieSliceCount {
  label: string;
  color: string;
  count: number;
}

export class AcousticProximityPanel {
  private readonly history = new MetricHistory(HISTORY_LENGTH);
  private mascCount = 0;
  private androCount = 0;
  private femCount = 0;
  private startedAt = Date.now();

  constructor(private readonly container: HTMLElement) {
    container.innerHTML = `
      <div class="acoustic-proximity-header">
        <span class="hud-label">Acoustic Proximity</span>
        <button type="button" class="info-btn" aria-expanded="false" aria-controls="info-acoustic-proximity" aria-label="About Acoustic Proximity">i</button>
        <div class="info-bubble" id="info-acoustic-proximity" role="note" hidden>${INFO_TEXT}</div>
      </div>
      <div class="acoustic-proximity-readout">
        <span data-role="prox-time">Time: 0m 0s</span>
      </div>
      <div class="acoustic-proximity-breakdown">
        ${CATEGORIES.map(
          (c) => `
          <div class="prox-breakdown-row" data-role="prox-row-${c.key}">
            <span class="prox-breakdown-label">${c.label}<span class="prox-target-mark" data-role="prox-target-${c.key}" hidden> &#127919;</span></span>
            <div class="prox-breakdown-bar"><div class="prox-breakdown-fill" data-role="prox-fill-${c.key}"></div></div>
            <span class="prox-breakdown-pct" data-role="prox-pct-${c.key}">--</span>
          </div>`,
        ).join("")}
      </div>
      <div class="acoustic-proximity-confidence" data-role="prox-confidence">Confidence: --</div>
      <canvas class="acoustic-proximity-spark" data-role="prox-spark" width="180" height="30"></canvas>
      <div class="acoustic-proximity-pie-row">
        <canvas class="acoustic-proximity-pie" data-role="prox-pie" width="60" height="60"></canvas>
        <ul class="acoustic-proximity-pie-legend" data-role="prox-pie-legend"></ul>
      </div>
    `;
  }

  private el(role: string): HTMLElement {
    return this.container.querySelector<HTMLElement>(`[data-role="${role}"]`)!;
  }

  private canvas(role: string): HTMLCanvasElement {
    return this.container.querySelector<HTMLCanvasElement>(`[data-role="${role}"]`)!;
  }

  update(pitchHz: number | null, f1: number | null, f2: number | null, hasSignal: boolean, targetRangePreset: TargetRangePreset): void {
    const proximity = hasSignal ? computeAcousticProximity(pitchHz, f1, f2) : null;
    this.history.push(proximity?.value ?? null);

    this.el("prox-time").textContent = `Time: ${formatElapsed(Date.now() - this.startedAt)}`;

    const targetCategory = targetAsCategory(targetRangePreset);
    const pctByCategory: Record<ProximityCategory, number | null> = {
      masculine: proximity?.masculinePct ?? null,
      androgynous: proximity?.androgynousPct ?? null,
      feminine: proximity?.femininePct ?? null,
    };
    for (const c of CATEGORIES) {
      const pct = pctByCategory[c.key];
      this.el(`prox-pct-${c.key}`).textContent = pct !== null ? `${Math.round(pct * 100)}%` : "--";
      const fillEl = this.el(`prox-fill-${c.key}`);
      fillEl.style.width = pct !== null ? `${Math.round(pct * 100)}%` : "0%";
      fillEl.style.background = categoryColor(c.key);
      this.el(`prox-row-${c.key}`).classList.toggle("prox-breakdown-row--dominant", proximity?.category === c.key);
      this.el(`prox-target-${c.key}`).hidden = targetCategory !== c.key;
    }

    if (proximity) {
      if (proximity.category === "masculine") this.mascCount++;
      else if (proximity.category === "feminine") this.femCount++;
      else this.androCount++;

      this.el("prox-confidence").textContent =
        proximity.confidence !== null ? `Confidence: ${Math.round(proximity.confidence * 100)}%` : "Confidence: -- (only one cue this frame)";
    } else {
      this.el("prox-confidence").textContent = "Confidence: --";
    }

    drawColorCodedSparkline(this.canvas("prox-spark"), this.history.getValues(), (v) => lerpHexColor(MASC_COLOR, FEM_COLOR, v), {
      min: 0,
      max: 1,
    });

    const slices: PieSliceCount[] = [
      { label: "Masculine-leaning", color: categoryColor("masculine"), count: this.mascCount },
      { label: "Androgynous", color: categoryColor("androgynous"), count: this.androCount },
      { label: "Feminine-leaning", color: categoryColor("feminine"), count: this.femCount },
    ];
    drawPieChart(
      this.canvas("prox-pie"),
      slices.map((s) => ({ value: s.count, color: s.color, label: s.label })),
    );
    this.renderPieLegend(slices);
  }

  private renderPieLegend(slices: PieSliceCount[]): void {
    const total = slices.reduce((a, s) => a + s.count, 0);
    const legend = this.el("prox-pie-legend");
    legend.innerHTML = slices
      .map((s) => {
        const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
        return `<li><span class="pie-legend-swatch" style="background:${s.color}"></span>${s.label}: ${pct}%</li>`;
      })
      .join("");
  }

  reset(): void {
    this.history.reset();
    this.mascCount = 0;
    this.androCount = 0;
    this.femCount = 0;
    this.startedAt = Date.now();
    this.el("prox-time").textContent = "Time: 0m 0s";
    for (const c of CATEGORIES) {
      this.el(`prox-pct-${c.key}`).textContent = "--";
      this.el(`prox-fill-${c.key}`).style.width = "0%";
      this.el(`prox-row-${c.key}`).classList.remove("prox-breakdown-row--dominant");
    }
    this.el("prox-confidence").textContent = "Confidence: --";
    this.el("prox-pie-legend").innerHTML = "";
    this.canvas("prox-spark").getContext("2d")?.clearRect(0, 0, 180, 30);
    this.canvas("prox-pie").getContext("2d")?.clearRect(0, 0, 60, 60);
  }
}
