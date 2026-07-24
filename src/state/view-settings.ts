import { DEFAULT_LPC_ORDER } from "../dsp/formants.ts";
import type { ColorScheme } from "../render/color-ramp.ts";

export type Theme = "dark" | "light";
export type FrequencyScale = "log" | "linear";
export type Resolution = "fine" | "balanced" | "fast";
export type TargetRangePreset = "off" | "masculine" | "androgynous" | "feminine" | "custom";
export type HistoryLength = "short" | "medium" | "long";

export const RESOLUTION_WINDOW_SECONDS: Record<Resolution, number> = {
  fine: 0.064,
  balanced: 0.032,
  fast: 0.016,
};

/** 3D waterfall depth (time slices); redrawn from scratch whenever this changes. */
export const HISTORY_LENGTH_SLICES: Record<HistoryLength, number> = {
  short: 80,
  medium: 160,
  long: 320,
};

export type ChartHeight = "short" | "medium" | "tall";

/** Backing pixel height for the 2D spectrogram, frequency ruler, and 3D canvas. */
export const CHART_HEIGHT_PX: Record<ChartHeight, number> = {
  short: 320,
  medium: 480,
  tall: 640,
};

/**
 * Approximate closed-band visualizations of ASHA's open-ended speaking fundamental
 * frequency guidance (<130Hz reads masculine, >180Hz reads feminine, 145-175Hz reads
 * androgynous/gender-neutral) — the source guidance doesn't prescribe upper/lower bounds,
 * these are practical ranges chosen for on-screen shading, not clinical cutoffs.
 */
export const TARGET_RANGE_PRESETS: Record<Exclude<TargetRangePreset, "off" | "custom">, [number, number]> = {
  masculine: [80, 130],
  androgynous: [145, 175],
  feminine: [180, 250],
};

export const MIN_FREQ = 65;
export const DEFAULT_LPC_ORDER_OPTIONS = [8, 10, 12, 14, 16, 20];

export interface ViewSettings {
  theme: Theme;
  scale: FrequencyScale;
  colorScheme: ColorScheme;
  maxFreq: number;
  resolution: Resolution;
  lpcOrder: number;
  historyLength: HistoryLength;
  chartHeight: ChartHeight;
  /** Upper bound of the color ramp, in dB. */
  brightnessDb: number;
  /** Lower bound of the color ramp, in dB — raising this mutes quiet background noise. */
  floorDb: number;
  /** Gain applied to the live mic signal before analysis/recording, in dB. Boosts a quiet mic or
   *  attenuates a hot one; 0 = unchanged. Not applied to clip playback — only live capture. */
  micGainDb: number;
  targetRangePreset: TargetRangePreset;
  /** Only meaningful when targetRangePreset === "custom". */
  customTargetMin: number;
  customTargetMax: number;
  /** Reference F2 (Hz) calibrated from the user's own /i/ vowel — Hirsch's "carry /i/'s tongue
   *  position across all vowels" technique, operationalized as a live deviation readout. */
  iAnchorF2: number | null;
  showPitch: boolean;
  /** Signed Hz distance from the Target range band — a companion to percentInTargetRange that
   *  shows which direction to adjust, not just a hit/miss count. */
  showTargetDistance: boolean;
  showF1F2: boolean;
  showF3: boolean;
  /** Independent of showPitch/showF1F2, which gate the HUD numeric readout — these gate only the
   *  colored trace dots drawn directly on the spectrogram/3D view. */
  showPitchTrace: boolean;
  showFormantTrace: boolean;
  showVowel: boolean;
  /** Off by default, unlike the other display toggles — this is the acoustic-proximity panel,
   *  a sensitive-topic feature the user should opt into rather than discover already turned on. */
  showAcousticProximity: boolean;
  showRingTwang: boolean;
  showCpp: boolean;
  showInflection: boolean;
  showAvgFormant: boolean;
  showInputLevel: boolean;
  showIAnchor: boolean;
  showHnr: boolean;
  showJitterShimmer: boolean;
  /** Off by default — recording is opt-in given how sensitive this data can be. */
  recordAudio: boolean;
  /** Off by default — analyzes the whole clip up front for instant seeking, at the cost of a
   *  short delay before playback starts. The live-streaming path is the safer default. */
  precomputePlayback: boolean;
  /** Target practice minutes per day, shown against actual time in the Progress view. Null = no goal set. */
  dailyGoalMinutes: number | null;
}

export function createDefaultSettings(): ViewSettings {
  return {
    theme: "light",
    scale: "log",
    colorScheme: "rainbow",
    maxFreq: 10000,
    resolution: "balanced",
    lpcOrder: DEFAULT_LPC_ORDER,
    historyLength: "medium",
    chartHeight: "medium",
    brightnessDb: -20,
    floorDb: -90,
    micGainDb: 0,
    targetRangePreset: "off",
    customTargetMin: 145,
    customTargetMax: 175,
    iAnchorF2: null,
    showPitch: true,
    showTargetDistance: true,
    showF1F2: true,
    showF3: true,
    showPitchTrace: true,
    showFormantTrace: true,
    showVowel: true,
    showAcousticProximity: true,
    showRingTwang: true,
    showCpp: true,
    showInflection: true,
    showAvgFormant: true,
    showInputLevel: true,
    showIAnchor: true,
    showHnr: true,
    showJitterShimmer: true,
    recordAudio: false,
    precomputePlayback: true,
    dailyGoalMinutes: null,
  };
}

/** Resolves the active target range, or null if target-range shading is off. */
export function resolveTargetRange(settings: ViewSettings): [number, number] | null {
  if (settings.targetRangePreset === "off") return null;
  if (settings.targetRangePreset === "custom") return [settings.customTargetMin, settings.customTargetMax];
  return TARGET_RANGE_PRESETS[settings.targetRangePreset];
}

/**
 * Signed distance (Hz) from the target range: negative = below the band, positive = above,
 * 0 = inside it. A companion to the strict in/out-of-band hit count — this shows which direction
 * to adjust and by how much, rather than a bare hit/miss percentage. Null if there's no target
 * range set or no pitch reading to compare against.
 */
export function targetDistanceHz(pitchHz: number | null, targetRangeHz: [number, number] | null): number | null {
  if (pitchHz === null || targetRangeHz === null) return null;
  if (pitchHz < targetRangeHz[0]) return pitchHz - targetRangeHz[0];
  if (pitchHz > targetRangeHz[1]) return pitchHz - targetRangeHz[1];
  return 0;
}
