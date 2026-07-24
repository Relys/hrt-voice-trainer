export interface SparklineOptions {
  min?: number;
  max?: number;
  color?: string;
}

function lerpChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** Interpolates between two "#rrggbb" hex colors at t in [0,1]. */
export function lerpHexColor(colorA: string, colorB: string, t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const a = [parseInt(colorA.slice(1, 3), 16), parseInt(colorA.slice(3, 5), 16), parseInt(colorA.slice(5, 7), 16)];
  const b = [parseInt(colorB.slice(1, 3), 16), parseInt(colorB.slice(3, 5), 16), parseInt(colorB.slice(5, 7), 16)];
  return `rgb(${lerpChannel(a[0], b[0], clamped)}, ${lerpChannel(a[1], b[1], clamped)}, ${lerpChannel(a[2], b[2], clamped)})`;
}

/** Like drawSparkline, but each segment is colored via colorForValue(value) instead of one fixed
 *  color — used where the metric's value itself carries meaning (e.g. a masc-typical/fem-typical
 *  acoustic-proximity trend), not just its trend shape. */
export function drawColorCodedSparkline(
  canvas: HTMLCanvasElement,
  values: Array<number | null>,
  colorForValue: (v: number) => string,
  opts: { min?: number; max?: number } = {},
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return;

  const min = opts.min ?? Math.min(...nums);
  const max = opts.max ?? Math.max(...nums);
  const range = max - min || 1;
  const n = values.length;

  let prev: { x: number; y: number } | null = null;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v === null) {
      prev = null;
      continue;
    }
    const x = (i / (n - 1)) * width;
    const y = height - ((v - min) / range) * height;
    if (prev) {
      ctx.strokeStyle = colorForValue(v);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    prev = { x, y };
  }
}

/** Draws a small trend line; `null` entries render as a gap so silent/gated stretches are visible. */
export function drawSparkline(canvas: HTMLCanvasElement, values: Array<number | null>, opts: SparklineOptions = {}): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return;

  const min = opts.min ?? Math.min(...nums);
  const max = opts.max ?? Math.max(...nums);
  const range = max - min || 1;

  ctx.strokeStyle = opts.color ?? "#5bcefa";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let started = false;
  const n = values.length;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v === null) {
      started = false;
      continue;
    }
    const x = (i / (n - 1)) * width;
    const y = height - ((v - min) / range) * height;
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}
