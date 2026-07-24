import { FEMININE_CORNER_VOWELS, MASCULINE_CORNER_VOWELS, VOWEL_CHART, type CornerVowelPoint } from "../dsp/vowel.ts";
import { isLightTheme } from "./theme.ts";

export type VowelChartMode = "vowel" | "cluster";

// Widened slightly past VOWEL_CHART's own range so the feminine corner-vowel cluster's highest
// F1/F2 points (see dsp/vowel.ts) don't clip against the plot edge.
const F1_MIN = 150;
const F1_MAX = 950;
const F2_MIN = 600;
const F2_MAX = 2800;
const TRAIL_LENGTH = 40;

function project(f1: number, f2: number, width: number, height: number): [number, number] {
  // IPA vowel-chart convention: F2 increases to the LEFT (front vowels), F1 increases DOWNWARD (open vowels).
  const xT = Math.max(0, Math.min(1, (f2 - F2_MIN) / (F2_MAX - F2_MIN)));
  const yT = Math.max(0, Math.min(1, (f1 - F1_MIN) / (F1_MAX - F1_MIN)));
  return [(1 - xT) * width, yT * height];
}

export class VowelChartRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly width: number;
  private readonly height: number;
  private trail: Array<{ f1: number; f2: number }> = [];
  private mode: VowelChartMode = "vowel";

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.width = canvas.width;
    this.height = canvas.height;
    this.drawBackground(null);
  }

  setMode(mode: VowelChartMode): void {
    this.mode = mode;
    this.drawBackground(null);
  }

  getMode(): VowelChartMode {
    return this.mode;
  }

  update(current: { f1: number; f2: number } | null, iAnchorF2: number | null): void {
    if (current) {
      this.trail.push(current);
      if (this.trail.length > TRAIL_LENGTH) this.trail.shift();
    }
    this.drawBackground(iAnchorF2);

    const { ctx, width, height } = this;
    this.trail.forEach((p, i) => {
      const [x, y] = project(p.f1, p.f2, width, height);
      const alpha = ((i + 1) / this.trail.length) * 0.5;
      ctx.fillStyle = `rgba(91, 206, 250, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
      ctx.fill();
    });

    if (current) {
      const [x, y] = project(current.f1, current.f2, width, height);
      ctx.fillStyle = "#5bcefa";
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = isLightTheme() ? "#14161c" : "#fff";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  reset(): void {
    this.trail = [];
    this.drawBackground(null);
  }

  private drawBackground(iAnchorF2: number | null): void {
    const { ctx, width, height } = this;
    const light = isLightTheme();
    ctx.fillStyle = light ? "#ffffff" : "#0b0d12";
    ctx.fillRect(0, 0, width, height);

    if (iAnchorF2 !== null) {
      const [x] = project(F1_MIN, iAnchorF2, width, height);
      ctx.strokeStyle = "rgba(245, 169, 184, 0.55)";
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (this.mode === "vowel") {
      this.drawVowelReferences(light);
    } else {
      this.drawClusterReferences();
    }

    ctx.strokeStyle = light ? "rgba(0, 0, 0, 0.15)" : "rgba(255, 255, 255, 0.15)";
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  }

  private drawVowelReferences(light: boolean): void {
    const { ctx, width, height } = this;
    ctx.font = "10px monospace";
    for (const vowel of VOWEL_CHART) {
      const [x, y] = project(vowel.f1, vowel.f2, width, height);
      ctx.fillStyle = light ? "rgba(0, 0, 0, 0.35)" : "rgba(255, 255, 255, 0.35)";
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = light ? "rgba(0, 0, 0, 0.6)" : "rgba(255, 255, 255, 0.6)";
      ctx.fillText(vowel.symbol, x + 5, y - 4);
    }
  }

  /** Draws the masculine/feminine corner-vowel quadrilaterals (population averages — see
   *  dsp/vowel.ts for the caveat these deliberately are NOT presented as strict categories). */
  private drawClusterReferences(): void {
    const { ctx, width, height } = this;

    const drawCluster = (points: CornerVowelPoint[], color: string, legendLabel: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      points.forEach((p, i) => {
        const [x, y] = project(p.f1, p.f2, width, height);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.font = "9px monospace";
      for (const p of points) {
        const [x, y] = project(p.f1, p.f2, width, height);
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillText(p.symbol, x + 4, y - 3);
      }

      const centroidF1 = points.reduce((a, b) => a + b.f1, 0) / points.length;
      const centroidF2 = points.reduce((a, b) => a + b.f2, 0) / points.length;
      const [cx, cy] = project(centroidF1, centroidF2, width, height);
      ctx.font = "bold 10px monospace";
      ctx.fillText(legendLabel, cx - 4, cy);
    };

    drawCluster(MASCULINE_CORNER_VOWELS, "rgba(91, 206, 250, 0.75)", "M");
    drawCluster(FEMININE_CORNER_VOWELS, "rgba(245, 169, 184, 0.75)", "F");
  }
}
