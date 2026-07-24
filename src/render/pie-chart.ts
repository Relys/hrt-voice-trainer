export interface PieSlice {
  value: number;
  color: string;
  label: string;
}

/** Draws a simple pie chart from non-negative slice values (auto-normalized to the total). */
export function drawPieChart(canvas: HTMLCanvasElement, slices: PieSlice[]): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  const total = slices.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return;

  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 2 - 2;
  let angle = -Math.PI / 2;
  for (const slice of slices) {
    if (slice.value <= 0) continue;
    const sliceAngle = (slice.value / total) * 2 * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, angle + sliceAngle);
    ctx.closePath();
    ctx.fillStyle = slice.color;
    ctx.fill();
    angle += sliceAngle;
  }
}
