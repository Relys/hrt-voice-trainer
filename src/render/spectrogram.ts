import { fractionToColor, frequencyToBin, magnitudeToDbFraction, sampleMagnitudeAtBin } from "./color-ramp.ts";
import { freqToT, tToFreq, type FrequencyMapping } from "./frequency-axis.ts";
import type { SpectrumResult } from "../shared/protocol.ts";
import { MIN_FREQ, resolveTargetRange, type ViewSettings } from "../state/view-settings.ts";

// Trans pride flag palette for the trace dots: pitch = blue, F1 = pink, F2 = white/gold
// (pure white would blend into loud/bright spectrogram pixels, so warm it slightly).
const PITCH_COLOR: [number, number, number] = [91, 206, 250];
const F1_COLOR: [number, number, number] = [245, 169, 184];
const F2_COLOR: [number, number, number] = [255, 233, 168];
/** Subtle pink tint blended into rows within the target range, at this weight. */
const TARGET_RANGE_TINT: [number, number, number] = [245, 169, 184];
const TARGET_RANGE_TINT_ALPHA = 0.12;
/** Smallest allowed zoom span, as a fraction of the full (Range-dropdown) window. */
const MIN_ZOOM_SPAN_T = 0.02;

export class SpectrogramRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly width: number;
  private readonly height: number;
  private columnImage: ImageData;

  /** Current zoomed/panned view, always a sub-window of [MIN_FREQ, settings.maxFreq]. */
  private viewMinFreq: number;
  private viewMaxFreq: number;
  private clearDebounceHandle: number | undefined;

  private dragging = false;
  private lastPointerY = 0;

  /** Pointer Events unify mouse/touch/pen, so single-finger drag-to-pan already works for free;
   *  this map tracks simultaneously active pointers to additionally detect a two-finger pinch. */
  private readonly activePointers = new Map<number, { x: number; y: number }>();
  private pinchStartDistance: number | null = null;
  private pinchStartViewMin = 0;
  private pinchStartViewMax = 0;
  private pinchCenterFreq = 0;

  private readonly onPointerDown = (e: PointerEvent) => {
    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.activePointers.size === 1) {
      this.dragging = true;
      this.lastPointerY = e.clientY;
    } else if (this.activePointers.size === 2) {
      this.dragging = false;
      this.beginPinch();
    }
  };
  private readonly onPointerMove = (e: PointerEvent) => {
    if (!this.activePointers.has(e.pointerId)) return;
    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.activePointers.size >= 2) {
      this.updatePinch();
      return;
    }
    if (this.dragging) {
      const dy = e.clientY - this.lastPointerY;
      this.lastPointerY = e.clientY;
      this.panBy(dy);
    }
  };
  private readonly onPointerUp = (e: PointerEvent) => {
    this.activePointers.delete(e.pointerId);
    if (this.activePointers.size < 2) this.pinchStartDistance = null;
    if (this.activePointers.size === 0) {
      this.dragging = false;
    } else if (this.activePointers.size === 1) {
      // One finger lifted off mid-pinch — resume single-finger pan from whichever pointer remains.
      const remaining = [...this.activePointers.values()][0];
      this.dragging = true;
      this.lastPointerY = remaining.y;
    }
  };

  private beginPinch(): void {
    const points = [...this.activePointers.values()];
    if (points.length < 2) return;
    this.pinchStartDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    this.pinchStartViewMin = this.viewMinFreq;
    this.pinchStartViewMax = this.viewMaxFreq;
    const rect = this.canvasEl.getBoundingClientRect();
    const midY = (points[0].y + points[1].y) / 2 - rect.top;
    const y = (midY / rect.height) * this.height;
    const t = Math.max(0, Math.min(1, 1 - y / (this.height - 1)));
    this.pinchCenterFreq = tToFreq(t, this.currentMapping());
  }

  private updatePinch(): void {
    const points = [...this.activePointers.values()];
    if (points.length < 2 || !this.pinchStartDistance) return;
    const currentDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    if (currentDistance === 0) return;
    // Fingers spreading apart (distance grows) should zoom in — recomputed relative to the
    // gesture's start each move, not compounded frame-to-frame, so it can't run away or drift.
    const zoomFactor = this.pinchStartDistance / currentDistance;
    this.viewMinFreq = this.pinchStartViewMin;
    this.viewMaxFreq = this.pinchStartViewMax;
    this.zoomAt(this.pinchCenterFreq, zoomFactor);
  }
  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = this.canvasEl.getBoundingClientRect();
    const cssY = e.clientY - rect.top;
    const y = (cssY / rect.height) * this.height; // account for the canvas's displayed CSS size differing from its backing resolution
    const t = Math.max(0, Math.min(1, 1 - y / (this.height - 1)));
    const cursorFreq = tToFreq(t, this.currentMapping());
    const zoomFactor = Math.exp(e.deltaY * 0.001);
    this.zoomAt(cursorFreq, zoomFactor);
  };
  private readonly onDoubleClick = () => {
    this.resetView();
  };

  constructor(
    private readonly canvasEl: HTMLCanvasElement,
    private readonly settings: ViewSettings,
    private readonly onViewChange?: (range: [number, number]) => void,
  ) {
    const ctx = canvasEl.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.width = canvasEl.width;
    this.height = canvasEl.height;
    this.columnImage = ctx.createImageData(1, this.height);
    this.viewMinFreq = MIN_FREQ;
    this.viewMaxFreq = settings.maxFreq;
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, this.width, this.height);

    canvasEl.addEventListener("pointerdown", this.onPointerDown);
    canvasEl.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    canvasEl.addEventListener("wheel", this.onWheel, { passive: false });
    canvasEl.addEventListener("dblclick", this.onDoubleClick);
  }

  clear(): void {
    this.ctx.fillStyle = "black";
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  getViewRange(): [number, number] {
    return [this.viewMinFreq, this.viewMaxFreq];
  }

  /** Call when `settings.maxFreq`/`scale` change — an interactive zoom into the old range would be stale/out of bounds. */
  resetView(): void {
    this.viewMinFreq = MIN_FREQ;
    this.viewMaxFreq = this.settings.maxFreq;
    this.onViewChange?.(this.getViewRange());
  }

  private currentMapping(): FrequencyMapping {
    return { minFreq: this.viewMinFreq, maxFreq: this.viewMaxFreq, scale: this.settings.scale };
  }

  /** The full outer range the Range dropdown allows zooming/panning within. */
  private fullRangeMapping(): FrequencyMapping {
    return { minFreq: MIN_FREQ, maxFreq: this.settings.maxFreq, scale: this.settings.scale };
  }

  private zoomAt(cursorFreq: number, zoomFactor: number): void {
    const full = this.fullRangeMapping();
    const tMin = freqToT(this.viewMinFreq, full);
    const tMax = freqToT(this.viewMaxFreq, full);
    const tCursor = freqToT(cursorFreq, full);
    let newTMin = tCursor - (tCursor - tMin) * zoomFactor;
    let newTMax = tCursor + (tMax - tCursor) * zoomFactor;
    if (newTMax - newTMin < MIN_ZOOM_SPAN_T) {
      const mid = (newTMin + newTMax) / 2;
      newTMin = mid - MIN_ZOOM_SPAN_T / 2;
      newTMax = mid + MIN_ZOOM_SPAN_T / 2;
    }
    newTMin = Math.max(0, newTMin);
    newTMax = Math.min(1, newTMax);
    if (newTMax <= newTMin) return;
    this.applyView(tToFreq(newTMin, full), tToFreq(newTMax, full));
  }

  private panBy(deltaYPixels: number): void {
    const full = this.fullRangeMapping();
    const tMin = freqToT(this.viewMinFreq, full);
    const tMax = freqToT(this.viewMaxFreq, full);
    const span = tMax - tMin;
    // Dragging down reveals higher frequencies (like grabbing the axis and pulling it down).
    const deltaT = (deltaYPixels / (this.height - 1)) * span;
    let newTMin = tMin + deltaT;
    let newTMax = tMax + deltaT;
    if (newTMin < 0) {
      newTMax += -newTMin;
      newTMin = 0;
    }
    if (newTMax > 1) {
      newTMin -= newTMax - 1;
      newTMax = 1;
    }
    newTMin = Math.max(0, newTMin);
    newTMax = Math.min(1, newTMax);
    this.applyView(tToFreq(newTMin, full), tToFreq(newTMax, full));
  }

  private applyView(newMin: number, newMax: number): void {
    this.viewMinFreq = newMin;
    this.viewMaxFreq = newMax;
    this.onViewChange?.(this.getViewRange());
    // The canvas only ever holds pixels, not the underlying spectra, so existing history can't
    // be redrawn under the new mapping — it'll need clearing eventually. But a wheel-zoom or
    // drag fires this many times a second, and clearing on every single one flashes the whole
    // canvas black repeatedly for as long as the gesture lasts. Debounce it instead: keep
    // whatever's on screen while the view is still moving, clear once, cleanly, after it settles.
    if (this.clearDebounceHandle !== undefined) window.clearTimeout(this.clearDebounceHandle);
    this.clearDebounceHandle = window.setTimeout(() => {
      this.clear();
      this.clearDebounceHandle = undefined;
    }, 200);
  }

  dispose(): void {
    if (this.clearDebounceHandle !== undefined) window.clearTimeout(this.clearDebounceHandle);
    this.canvasEl.removeEventListener("pointerdown", this.onPointerDown);
    this.canvasEl.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.canvasEl.removeEventListener("wheel", this.onWheel);
    this.canvasEl.removeEventListener("dblclick", this.onDoubleClick);
  }

  /** Pushes one new time column, scrolling existing content one pixel left. */
  pushColumn(result: SpectrumResult): void {
    const { ctx, width, height } = this;
    const imageData = ctx.getImageData(1, 0, width - 1, height);
    ctx.putImageData(imageData, 0, 0);
    // columnImage is a 1px-wide buffer, so its own row stride is 1 (col is always 0).
    this.writeColumnPixels(this.columnImage.data, 0, 1, result);
    ctx.putImageData(this.columnImage, width - 1, 0);
  }

  /**
   * Redraws the whole visible strip in one shot from a batch of results (newest last) — used
   * when jumping to a new playback position. Building the full image in a plain JS buffer and
   * writing it with a single putImageData is dramatically cheaper than calling pushColumn once
   * per frame: pushColumn's shift-then-blit costs a get+putImageData over nearly the whole
   * canvas *per call*, which is fine at the ~100Hz live rate but never meant to run in a tight
   * synchronous loop hundreds of times over, which is exactly what a naive seek replay would do.
   */
  replayColumns(results: SpectrumResult[]): void {
    const { ctx, width, height } = this;
    const visible = results.length > width ? results.slice(results.length - width) : results;
    const fullImage = ctx.createImageData(width, height);
    const leadingBlank = width - visible.length;
    for (let i = 0; i < visible.length; i++) {
      // fullImage is `width` px wide, so its row stride is `width`.
      this.writeColumnPixels(fullImage.data, leadingBlank + i, width, visible[i]);
    }
    for (let col = 0; col < leadingBlank; col++) {
      for (let y = 0; y < height; y++) {
        fullImage.data[(y * width + col) * 4 + 3] = 255; // black (0,0,0) but opaque
      }
    }
    ctx.putImageData(fullImage, 0, 0);
  }

  /** Computes one column's pixels and writes them into `data` at column `col` of a `stride`-px-wide image. */
  private writeColumnPixels(data: Uint8ClampedArray, col: number, stride: number, result: SpectrumResult): void {
    const { magnitudes, sampleRate, fftSize, formants, pitch } = result;
    const { height, settings } = this;
    const mapping = this.currentMapping();
    const targetRange = resolveTargetRange(settings);

    for (let y = 0; y < height; y++) {
      const t = 1 - y / (height - 1);
      const freq = tToFreq(t, mapping);
      const bin = frequencyToBin(freq, sampleRate, fftSize);
      const mag = sampleMagnitudeAtBin(magnitudes, bin);
      const dbFrac = magnitudeToDbFraction(mag, settings.floorDb, settings.brightnessDb);
      let [r, g, b] = fractionToColor(dbFrac, settings.colorScheme);
      if (targetRange && freq >= targetRange[0] && freq <= targetRange[1]) {
        r = r * (1 - TARGET_RANGE_TINT_ALPHA) + (TARGET_RANGE_TINT[0] / 255) * TARGET_RANGE_TINT_ALPHA;
        g = g * (1 - TARGET_RANGE_TINT_ALPHA) + (TARGET_RANGE_TINT[1] / 255) * TARGET_RANGE_TINT_ALPHA;
        b = b * (1 - TARGET_RANGE_TINT_ALPHA) + (TARGET_RANGE_TINT[2] / 255) * TARGET_RANGE_TINT_ALPHA;
      }
      const offset = (y * stride + col) * 4;
      data[offset] = Math.round(r * 255);
      data[offset + 1] = Math.round(g * 255);
      data[offset + 2] = Math.round(b * 255);
      data[offset + 3] = 255;
    }

    if (settings.showPitchTrace && pitch) {
      this.stampDot(data, col, stride, mapping, pitch.frequency, PITCH_COLOR);
    }
    if (settings.showFormantTrace && formants.length > 0) {
      this.stampDot(data, col, stride, mapping, formants[0].frequency, F1_COLOR);
      if (formants.length > 1) this.stampDot(data, col, stride, mapping, formants[1].frequency, F2_COLOR);
    }
  }

  private stampDot(
    data: Uint8ClampedArray,
    col: number,
    stride: number,
    mapping: FrequencyMapping,
    freq: number,
    color: [number, number, number],
  ): void {
    const { height } = this;
    const t = freqToT(freq, mapping);
    const y = Math.round((1 - t) * (height - 1));
    // A dark outline first, then the core color on top — a plain colored dot can vanish against
    // a similarly bright background pixel (e.g. F2's off-white next to viridis's yellow peak);
    // the outline guarantees contrast regardless of what color scheme or loudness sits under it.
    for (const dy of [-2, 2]) {
      const yy = y + dy;
      if (yy < 0 || yy >= height) continue;
      const offset = (yy * stride + col) * 4;
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 255;
    }
    for (const dy of [-1, 0, 1]) {
      const yy = y + dy;
      if (yy < 0 || yy >= height) continue;
      const offset = (yy * stride + col) * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = 255;
    }
  }
}
