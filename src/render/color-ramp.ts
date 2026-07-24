export type ColorScheme = "rainbow" | "hot" | "viridis" | "grayscale";

export function magnitudeToDbFraction(magnitude: number, floorDb: number, brightnessDb: number): number {
  const db = 20 * Math.log10(magnitude + 1e-12);
  return Math.max(0, Math.min(1, (db - floorDb) / (brightnessDb - floorDb)));
}

/** HSV -> RGB, h in degrees [0,360), s/v in [0,1]. All outputs in [0,1]. */
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const hh = h / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 1) {
    r = c;
    g = x;
  } else if (hh < 2) {
    r = x;
    g = c;
  } else if (hh < 3) {
    g = c;
    b = x;
  } else if (hh < 4) {
    g = x;
    b = c;
  } else if (hh < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const m = v - c;
  return [r + m, g + m, b + m];
}

/** Full HSV hue-wheel sweep, matching Chrome Music Lab's sonogram shader: very high visual
 *  distinction between levels, at the cost of not being perceptually monotonic (hue order alone
 *  doesn't say "louder"). Value (brightness) is scaled by `t` too, same as the reference shader
 *  multiplying its hue color by loudness before adding it to a black background — otherwise
 *  silence would render as a solid full-brightness color (red) instead of fading to black. */
function rainbow(t: number): [number, number, number] {
  return hsvToRgb(360 - t * 360, 1, t);
}

/** Classic "hot" thermal ramp (matplotlib's breakpoints): black -> red -> orange -> yellow -> white.
 *  Brightness rises monotonically with level, unlike a pure hue sweep. */
function hot(t: number): [number, number, number] {
  const r = Math.min(1, t / 0.365);
  const g = Math.min(1, Math.max(0, (t - 0.365) / (0.746 - 0.365)));
  const b = Math.min(1, Math.max(0, (t - 0.746) / (1 - 0.746)));
  return [r, g, b];
}

/** Six-stop approximation of matplotlib's viridis — perceptually-uniform and colorblind-safe. */
const VIRIDIS_STOPS: ReadonlyArray<readonly [number, number, number]> = [
  [68, 1, 84],
  [65, 68, 135],
  [42, 120, 142],
  [34, 168, 132],
  [122, 209, 81],
  [253, 231, 37],
];

function viridis(t: number): [number, number, number] {
  const scaled = t * (VIRIDIS_STOPS.length - 1);
  const i0 = Math.floor(scaled);
  const i1 = Math.min(VIRIDIS_STOPS.length - 1, i0 + 1);
  const frac = scaled - i0;
  const a = VIRIDIS_STOPS[i0];
  const b = VIRIDIS_STOPS[i1];
  return [(a[0] + (b[0] - a[0]) * frac) / 255, (a[1] + (b[1] - a[1]) * frac) / 255, (a[2] + (b[2] - a[2]) * frac) / 255];
}

function grayscale(t: number): [number, number, number] {
  return [t, t, t];
}

/** Maps a normalized loudness fraction [0,1] to an RGB color (each channel [0,1]) under the given scheme. */
export function fractionToColor(t: number, scheme: ColorScheme = "viridis"): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  switch (scheme) {
    case "rainbow":
      return rainbow(clamped);
    case "hot":
      return hot(clamped);
    case "grayscale":
      return grayscale(clamped);
    case "viridis":
    default:
      return viridis(clamped);
  }
}

/** Linear-interpolated sample of a magnitude array at fractional bin index. */
export function sampleMagnitudeAtBin(magnitudes: Float64Array, bin: number): number {
  const clamped = Math.max(0, Math.min(magnitudes.length - 1, bin));
  const lo = Math.floor(clamped);
  const hi = Math.min(magnitudes.length - 1, lo + 1);
  const t = clamped - lo;
  return magnitudes[lo] * (1 - t) + magnitudes[hi] * t;
}

/** Bin `k` of an N-point FFT corresponds to frequency k * sampleRate / N. */
export function frequencyToBin(freqHz: number, sampleRate: number, fftSize: number): number {
  return (freqHz * fftSize) / sampleRate;
}
