import { formatTickLabel, freqToT, generateOctaveTicks, type FrequencyMapping } from "./frequency-axis.ts";

export const TARGET_RANGE_FILL = "rgba(245, 169, 184, 0.16)";
export const TARGET_RANGE_BORDER = "rgba(245, 169, 184, 0.6)";

/** Draws (or redraws) a vertical frequency ruler with log- or linear-spaced octave ticks. */
export function drawVerticalFrequencyRuler(
  canvas: HTMLCanvasElement,
  mapping: FrequencyMapping,
  targetRange: [number, number] | null = null,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;

  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, width, height);

  if (targetRange) {
    const yTop = Math.round((1 - freqToT(targetRange[1], mapping)) * (height - 1));
    const yBottom = Math.round((1 - freqToT(targetRange[0], mapping)) * (height - 1));
    ctx.fillStyle = TARGET_RANGE_FILL;
    ctx.fillRect(0, yTop, width, yBottom - yTop);
    ctx.strokeStyle = TARGET_RANGE_BORDER;
    ctx.beginPath();
    ctx.moveTo(0, yTop + 0.5);
    ctx.lineTo(width, yTop + 0.5);
    ctx.moveTo(0, yBottom + 0.5);
    ctx.lineTo(width, yBottom + 0.5);
    ctx.stroke();
  }

  ctx.strokeStyle = "#555";
  ctx.fillStyle = "#ccc";
  ctx.font = "11px monospace";
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";

  for (const freq of generateOctaveTicks(mapping.minFreq, mapping.maxFreq)) {
    const t = freqToT(freq, mapping);
    const y = Math.round((1 - t) * (height - 1)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(width - 8, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.fillText(formatTickLabel(freq), width - 10, y);
  }
}
