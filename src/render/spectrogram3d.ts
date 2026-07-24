import { fractionToColor, frequencyToBin, magnitudeToDbFraction, sampleMagnitudeAtBin } from "./color-ramp.ts";
import { formatTickLabel, freqToT, generateOctaveTicks, tToFreq, type FrequencyMapping } from "./frequency-axis.ts";
import {
  identity,
  multiply,
  perspective,
  rotationX,
  rotationY,
  transformPoint,
  translation,
  type Mat4,
} from "./gl-math.ts";
import type { SpectrumResult } from "../shared/protocol.ts";
import { MIN_FREQ, type ViewSettings } from "../state/view-settings.ts";

const VERTEX_SHADER = `#version 300 es
in vec3 position;
in vec3 color;
uniform mat4 mvp;
out vec3 vColor;
void main() {
  vColor = color;
  gl_PointSize = 7.0;
  gl_Position = mvp * vec4(position, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec3 vColor;
out vec4 fragColor;
void main() {
  fragColor = vec4(vColor, 1.0);
}`;

const BAND_VERTEX_SHADER = `#version 300 es
in vec3 position;
uniform mat4 mvp;
void main() {
  gl_Position = mvp * vec4(position, 1.0);
}`;

const BAND_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform vec4 color;
out vec4 fragColor;
void main() {
  fragColor = color;
}`;

const TARGET_RANGE_COLOR: [number, number, number, number] = [245 / 255, 169 / 255, 184 / 255, 0.18];

export type CameraPreset = "top" | "front" | "side" | "oblique";

/**
 * Pitch is clamped to [-1.4, 1.4] rad by drag-to-rotate (see onPointerMove) — "top" and "side"
 * reuse that same ceiling/right-angle rather than the true-vertical pi/2, avoiding a degenerate
 * view at the pole.
 *
 * The mesh's time axis (z, built in initStaticXZ ranging from 0 at the newest column to -2 at
 * the oldest) is centered on -1, not 0. A yaw of +90 degrees rotates that axis onto screen-X —
 * which is what makes time scroll horizontally instead of vertically, entering from the right and
 * aging toward the left, matching the 2D view — but since it's off-center, the mesh would render
 * shifted entirely into the left half of the frame. `panX` cancels exactly that: +1 recenters it.
 */
const CAMERA_PRESETS: Record<CameraPreset, { yaw: number; pitch: number; panX: number }> = {
  top: { yaw: Math.PI / 2, pitch: 1.4, panX: 1 },
  front: { yaw: 0, pitch: 0, panX: 0 },
  side: { yaw: Math.PI / 2, pitch: 0, panX: 1 },
  oblique: { yaw: 0.6, pitch: 0.5, panX: 0 },
};

// Trans pride flag palette for the point overlay: pitch = blue, F1 = pink, F2 = white/gold.
const PITCH_COLOR: [number, number, number] = [91 / 255, 206 / 255, 250 / 255];
const F1_COLOR: [number, number, number] = [245 / 255, 169 / 255, 184 / 255];
const F2_COLOR: [number, number, number] = [1, 233 / 255, 168 / 255];
const FORMANT_POINT_HEIGHT = 1.3;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Failed to create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${log}`);
  }
  return shader;
}

function heightScale(t: number): number {
  return t * 1.1;
}

interface AxisTick {
  x: number;
  element: HTMLDivElement;
}

interface FormantRow {
  pitch: number;
  f1: number;
  f2: number;
}

export class Spectrogram3D {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly positionBuffer: WebGLBuffer;
  private readonly colorBuffer: WebGLBuffer;
  private readonly pointPositionBuffer: WebGLBuffer;
  private readonly pointColorBuffer: WebGLBuffer;
  private readonly indexCount: number;
  private readonly mvpLocation: WebGLUniformLocation;

  private readonly bandProgram: WebGLProgram;
  private readonly bandPositionBuffer: WebGLBuffer;
  private readonly bandMvpLocation: WebGLUniformLocation;
  private readonly bandColorLocation: WebGLUniformLocation;
  private readonly bandPositions = new Float32Array(6 * 3);
  private targetRange: [number, number] | null = null;

  private readonly freqBins: number;
  private readonly timeSlices: number;
  /** Frequency (Hz) each column samples; recomputed whenever the axis mapping changes. */
  private columnFrequencies: number[];
  /** Row-major; row 0 is always the newest slice. */
  private readonly heightRows: Float32Array[];
  private readonly formantRows: FormantRow[];
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly pointPositions: Float32Array;
  private readonly pointColors: Float32Array;
  private pointCount = 0;
  private dirty = false;

  private readonly axisContainer: HTMLElement | undefined;
  private axisTicks: AxisTick[] = [];

  private yaw = CAMERA_PRESETS.top.yaw;
  private pitch = CAMERA_PRESETS.top.pitch;
  private panX = CAMERA_PRESETS.top.panX;
  private distance = 2.6;
  private dragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;

  // Two simultaneous pointers (touch) means pinch-to-zoom instead of orbit — tracked by
  // pointerId so either finger can lift first without confusing the other's position.
  private readonly activePointers = new Map<number, { x: number; y: number }>();
  private pinchStartSpread: number | null = null;
  private pinchStartDistance = 0;

  private rafHandle: number | undefined;
  private readonly onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.activePointers.size >= 2) {
      this.dragging = false;
      this.beginPinch();
      return;
    }
    this.dragging = true;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    // panX only makes sense at the exact preset angle it was computed for — once the user
    // starts freely orbiting, fall back to the original unpanned framing.
    this.panX = 0;
  };
  private beginPinch(): void {
    const [a, b] = Array.from(this.activePointers.values());
    if (!a || !b) return;
    this.pinchStartSpread = Math.hypot(a.x - b.x, a.y - b.y);
    this.pinchStartDistance = this.distance;
  }
  private readonly onPointerMove = (e: PointerEvent) => {
    if (!this.activePointers.has(e.pointerId)) return;
    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.activePointers.size >= 2) {
      e.preventDefault();
      const [a, b] = Array.from(this.activePointers.values());
      const spread = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchStartSpread && spread > 0) {
        // Fingers spreading apart (spread grows past the start) zooms in, so the ratio is
        // inverted: a bigger spread yields a smaller camera distance.
        const ratio = this.pinchStartSpread / spread;
        this.distance = Math.max(1.2, Math.min(8, this.pinchStartDistance * ratio));
      }
      return;
    }

    if (!this.dragging) return;
    e.preventDefault();
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.yaw += dx * 0.01;
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + dy * 0.01));
  };
  private readonly onPointerUp = (e: PointerEvent) => {
    this.activePointers.delete(e.pointerId);
    this.pinchStartSpread = null;
    if (this.activePointers.size === 1) {
      // Resume single-finger orbiting from its current position rather than jumping by
      // whatever distance it moved while the pinch was in progress.
      const [remaining] = this.activePointers.values();
      this.dragging = true;
      this.lastPointerX = remaining.x;
      this.lastPointerY = remaining.y;
    } else {
      this.dragging = false;
    }
  };
  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.distance = Math.max(1.2, Math.min(8, this.distance + e.deltaY * 0.002));
  };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly settings: ViewSettings,
    opts: { freqBins?: number; timeSlices?: number; labelContainer?: HTMLElement } = {},
  ) {
    this.freqBins = opts.freqBins ?? 96;
    this.timeSlices = opts.timeSlices ?? 160;
    if (this.freqBins * this.timeSlices >= 65536) {
      throw new Error("Spectrogram3D: freqBins * timeSlices must stay under 65536 (uint16 indices)");
    }

    const gl = canvas.getContext("webgl2");
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program) throw new Error("Failed to create program");
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link error: ${gl.getProgramInfoLog(program)}`);
    }
    this.program = program;

    const mvpLoc = gl.getUniformLocation(program, "mvp");
    if (!mvpLoc) throw new Error("mvp uniform not found");
    this.mvpLocation = mvpLoc;

    const bandVs = compileShader(gl, gl.VERTEX_SHADER, BAND_VERTEX_SHADER);
    const bandFs = compileShader(gl, gl.FRAGMENT_SHADER, BAND_FRAGMENT_SHADER);
    const bandProgram = gl.createProgram();
    if (!bandProgram) throw new Error("Failed to create band program");
    gl.attachShader(bandProgram, bandVs);
    gl.attachShader(bandProgram, bandFs);
    gl.linkProgram(bandProgram);
    if (!gl.getProgramParameter(bandProgram, gl.LINK_STATUS)) {
      throw new Error(`Band program link error: ${gl.getProgramInfoLog(bandProgram)}`);
    }
    this.bandProgram = bandProgram;
    const bandMvpLoc = gl.getUniformLocation(bandProgram, "mvp");
    const bandColorLoc = gl.getUniformLocation(bandProgram, "color");
    if (!bandMvpLoc || !bandColorLoc) throw new Error("band uniform not found");
    this.bandMvpLocation = bandMvpLoc;
    this.bandColorLocation = bandColorLoc;
    const bandPositionBuffer = gl.createBuffer();
    if (!bandPositionBuffer) throw new Error("Failed to create band buffer");
    this.bandPositionBuffer = bandPositionBuffer;

    this.columnFrequencies = this.computeColumnFrequencies();

    this.heightRows = Array.from({ length: this.timeSlices }, () => new Float32Array(this.freqBins));
    this.formantRows = Array.from({ length: this.timeSlices }, () => ({ pitch: NaN, f1: NaN, f2: NaN }));
    this.positions = new Float32Array(this.freqBins * this.timeSlices * 3);
    this.colors = new Float32Array(this.freqBins * this.timeSlices * 3);
    this.pointPositions = new Float32Array(this.timeSlices * 3 * 3);
    this.pointColors = new Float32Array(this.timeSlices * 3 * 3);
    this.initStaticXZ();

    const positionBuffer = gl.createBuffer();
    const colorBuffer = gl.createBuffer();
    const pointPositionBuffer = gl.createBuffer();
    const pointColorBuffer = gl.createBuffer();
    if (!positionBuffer || !colorBuffer || !pointPositionBuffer || !pointColorBuffer) {
      throw new Error("Failed to create buffers");
    }
    this.positionBuffer = positionBuffer;
    this.colorBuffer = colorBuffer;
    this.pointPositionBuffer = pointPositionBuffer;
    this.pointColorBuffer = pointColorBuffer;

    const indices = this.buildIndices();
    this.indexCount = indices.length;
    const indexBuffer = gl.createBuffer();
    if (!indexBuffer) throw new Error("Failed to create index buffer");
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.02, 0.02, 0.03, 1);

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });

    this.axisContainer = opts.labelContainer;
    if (this.axisContainer) this.buildAxisLabels(this.axisContainer);
  }

  private currentMapping(): FrequencyMapping {
    return { minFreq: MIN_FREQ, maxFreq: this.settings.maxFreq, scale: this.settings.scale };
  }

  private computeColumnFrequencies(): number[] {
    const mapping = this.currentMapping();
    return Array.from({ length: this.freqBins }, (_, col) => tToFreq(col / (this.freqBins - 1), mapping));
  }

  /** Call after `scale` or `maxFreq` change on the shared settings object. */
  refreshFrequencyMapping(): void {
    this.columnFrequencies = this.computeColumnFrequencies();
    if (this.axisContainer) {
      for (const tick of this.axisTicks) tick.element.remove();
      this.axisTicks = [];
      this.buildAxisLabels(this.axisContainer);
    }
    this.rebuildTargetRangeGeometry();
  }

  /** A translucent horizontal band marking a target frequency range (or null to hide it). */
  setTargetRange(range: [number, number] | null): void {
    this.targetRange = range;
    this.rebuildTargetRangeGeometry();
  }

  /** Snaps the camera to a named angle; distance/zoom is left as-is since the user set that separately. */
  setCameraPreset(preset: CameraPreset): void {
    const { yaw, pitch, panX } = CAMERA_PRESETS[preset];
    this.yaw = yaw;
    this.pitch = pitch;
    this.panX = panX;
  }

  private rebuildTargetRangeGeometry(): void {
    if (!this.targetRange) return;
    const mapping = this.currentMapping();
    const xMin = freqToT(this.targetRange[0], mapping) * 2 - 1;
    const xMax = freqToT(this.targetRange[1], mapping) * 2 - 1;
    const y = 0.002;
    const zNear = 0;
    const zFar = -2;
    const p = this.bandPositions;
    const set = (i: number, x: number, yy: number, z: number) => {
      p[i * 3] = x;
      p[i * 3 + 1] = yy;
      p[i * 3 + 2] = z;
    };
    set(0, xMin, y, zNear);
    set(1, xMax, y, zNear);
    set(2, xMin, y, zFar);
    set(3, xMax, y, zNear);
    set(4, xMax, y, zFar);
    set(5, xMin, y, zFar);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.bandPositionBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, p, this.gl.DYNAMIC_DRAW);
  }

  clear(): void {
    for (const row of this.heightRows) row.fill(0);
    for (const row of this.formantRows) {
      row.pitch = NaN;
      row.f1 = NaN;
      row.f2 = NaN;
    }
    this.dirty = true;
  }

  private buildAxisLabels(container: HTMLElement): void {
    const mapping = this.currentMapping();
    for (const freq of generateOctaveTicks(mapping.minFreq, mapping.maxFreq)) {
      const element = document.createElement("div");
      element.className = "axis-tick-label-3d";
      element.textContent = formatTickLabel(freq);
      container.appendChild(element);
      this.axisTicks.push({ x: freqToT(freq, mapping) * 2 - 1, element });
    }
  }

  private updateAxisLabels(mvp: Mat4): void {
    const { canvas } = this;
    const cssWidth = canvas.clientWidth || canvas.width;
    const cssHeight = canvas.clientHeight || canvas.height;
    for (const tick of this.axisTicks) {
      const [cx, cy, , cw] = transformPoint(mvp, tick.x, 0, 0);
      if (cw <= 0.01) {
        tick.element.style.display = "none";
        continue;
      }
      const ndcX = cx / cw;
      const ndcY = cy / cw;
      if (ndcX < -1.3 || ndcX > 1.3 || ndcY < -1.3 || ndcY > 1.3) {
        tick.element.style.display = "none";
        continue;
      }
      const screenX = (ndcX * 0.5 + 0.5) * cssWidth;
      const screenY = (1 - (ndcY * 0.5 + 0.5)) * cssHeight;
      tick.element.style.display = "block";
      tick.element.style.left = `${screenX}px`;
      tick.element.style.top = `${screenY}px`;
    }
  }

  private initStaticXZ(): void {
    const { freqBins, timeSlices, positions } = this;
    for (let row = 0; row < timeSlices; row++) {
      const z = -(row / (timeSlices - 1)) * 2;
      for (let col = 0; col < freqBins; col++) {
        const x = (col / (freqBins - 1)) * 2 - 1;
        const idx = (row * freqBins + col) * 3;
        positions[idx] = x;
        positions[idx + 2] = z;
      }
    }
  }

  private buildIndices(): Uint16Array {
    const { freqBins, timeSlices } = this;
    const indices = new Uint16Array((freqBins - 1) * (timeSlices - 1) * 6);
    let p = 0;
    for (let row = 0; row < timeSlices - 1; row++) {
      for (let col = 0; col < freqBins - 1; col++) {
        const i0 = row * freqBins + col;
        const i1 = row * freqBins + col + 1;
        const i2 = (row + 1) * freqBins + col;
        const i3 = (row + 1) * freqBins + col + 1;
        indices[p++] = i0;
        indices[p++] = i2;
        indices[p++] = i1;
        indices[p++] = i1;
        indices[p++] = i2;
        indices[p++] = i3;
      }
    }
    return indices;
  }

  /** Feeds one new spectrum frame; resamples to `freqBins` over the current range and scrolls the mesh. */
  pushSpectrum(result: SpectrumResult): void {
    const { magnitudes, sampleRate, fftSize, formants, pitch } = result;
    const { freqBins, heightRows, formantRows, columnFrequencies, settings } = this;
    const incoming = heightRows.pop()!;
    heightRows.unshift(incoming);
    for (let col = 0; col < freqBins; col++) {
      const bin = frequencyToBin(columnFrequencies[col], sampleRate, fftSize);
      const mag = sampleMagnitudeAtBin(magnitudes, bin);
      incoming[col] = magnitudeToDbFraction(mag, settings.floorDb, settings.brightnessDb);
    }

    const incomingFormants = formantRows.pop()!;
    formantRows.unshift(incomingFormants);
    incomingFormants.pitch = pitch ? pitch.frequency : NaN;
    incomingFormants.f1 = formants.length > 0 ? formants[0].frequency : NaN;
    incomingFormants.f2 = formants.length > 1 ? formants[1].frequency : NaN;

    this.dirty = true;
  }

  private syncBuffers(): void {
    const { freqBins, timeSlices, heightRows, positions, colors, gl, settings } = this;
    for (let row = 0; row < timeSlices; row++) {
      const rowHeights = heightRows[row];
      for (let col = 0; col < freqBins; col++) {
        const t = rowHeights[col];
        const idx = (row * freqBins + col) * 3;
        positions[idx + 1] = heightScale(t);
        const [r, g, b] = fractionToColor(t, settings.colorScheme);
        colors[idx] = r;
        colors[idx + 1] = g;
        colors[idx + 2] = b;
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);

    this.syncFeaturePoints();
  }

  private syncFeaturePoints(): void {
    const { timeSlices, formantRows, pointPositions, pointColors, gl, settings } = this;
    if (!settings.showFormantTrace && !settings.showPitchTrace) {
      this.pointCount = 0;
      return;
    }
    const mapping = this.currentMapping();
    let p = 0;
    const stamp = (freq: number, z: number, color: [number, number, number]) => {
      const x = freqToT(freq, mapping) * 2 - 1;
      const idx = p * 3;
      pointPositions[idx] = x;
      pointPositions[idx + 1] = FORMANT_POINT_HEIGHT;
      pointPositions[idx + 2] = z;
      pointColors[idx] = color[0];
      pointColors[idx + 1] = color[1];
      pointColors[idx + 2] = color[2];
      p++;
    };
    for (let row = 0; row < timeSlices; row++) {
      const z = -(row / (timeSlices - 1)) * 2;
      const { pitch, f1, f2 } = formantRows[row];
      if (settings.showPitchTrace && !Number.isNaN(pitch)) stamp(pitch, z, PITCH_COLOR);
      if (settings.showFormantTrace && !Number.isNaN(f1)) stamp(f1, z, F1_COLOR);
      if (settings.showFormantTrace && !Number.isNaN(f2)) stamp(f2, z, F2_COLOR);
    }
    this.pointCount = p;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointPositionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, pointPositions, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, pointColors, gl.DYNAMIC_DRAW);
  }

  private computeMvp(): Mat4 {
    const { canvas } = this;
    const aspect = canvas.width / canvas.height;
    const projection = perspective((50 * Math.PI) / 180, aspect, 0.1, 20);
    const view = multiply(translation(this.panX, -0.3, -this.distance), multiply(rotationX(this.pitch), rotationY(this.yaw)));
    const model = identity();
    return multiply(multiply(projection, view), model);
  }

  private drawFrame = (): void => {
    const gl = this.gl;
    if (this.dirty) {
      this.syncBuffers();
      this.dirty = false;
    }

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);

    const mvp = this.computeMvp();
    gl.uniformMatrix4fv(this.mvpLocation, false, mvp);

    const positionLoc = gl.getAttribLocation(this.program, "position");
    const colorLoc = gl.getAttribLocation(this.program, "color");

    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.enableVertexAttribArray(colorLoc);
    gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);

    if (this.pointCount > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pointPositionBuffer);
      gl.vertexAttribPointer(positionLoc, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pointColorBuffer);
      gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.POINTS, 0, this.pointCount);
    }

    if (this.targetRange) {
      gl.useProgram(this.bandProgram);
      gl.uniformMatrix4fv(this.bandMvpLocation, false, mvp);
      gl.uniform4f(this.bandColorLocation, ...TARGET_RANGE_COLOR);
      gl.depthMask(false);
      const bandPositionLoc = gl.getAttribLocation(this.bandProgram, "position");
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bandPositionBuffer);
      gl.enableVertexAttribArray(bandPositionLoc);
      gl.vertexAttribPointer(bandPositionLoc, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.depthMask(true);
    }

    this.updateAxisLabels(mvp);

    this.rafHandle = requestAnimationFrame(this.drawFrame);
  };

  start(): void {
    if (this.rafHandle !== undefined) return;
    this.dirty = true;
    this.rafHandle = requestAnimationFrame(this.drawFrame);
  }

  stop(): void {
    if (this.rafHandle !== undefined) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = undefined;
  }

  dispose(): void {
    this.stop();
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    for (const tick of this.axisTicks) tick.element.remove();
  }
}
