import type { FrequencyScale } from "../state/view-settings.ts";

export interface FrequencyMapping {
  minFreq: number;
  maxFreq: number;
  scale: FrequencyScale;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

/** Normalized [0, 1] position of `freq` along the given axis mapping. */
export function freqToT(freq: number, mapping: FrequencyMapping): number {
  if (mapping.scale === "linear") {
    return clamp01((freq - mapping.minFreq) / (mapping.maxFreq - mapping.minFreq));
  }
  return clamp01(Math.log2(freq / mapping.minFreq) / Math.log2(mapping.maxFreq / mapping.minFreq));
}

export function tToFreq(t: number, mapping: FrequencyMapping): number {
  if (mapping.scale === "linear") {
    return mapping.minFreq + t * (mapping.maxFreq - mapping.minFreq);
  }
  return mapping.minFreq * Math.pow(mapping.maxFreq / mapping.minFreq, t);
}

export function noteNameForFrequency(freq: number): string {
  const midi = 69 + 12 * Math.log2(freq / 440);
  const rounded = Math.round(midi);
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return `${name}${octave}`;
}

/** C-note ticks within [minFreq, maxFreq] — one per octave. */
export function generateOctaveTicks(minFreq: number, maxFreq: number): number[] {
  const C0 = 16.3516;
  const ticks: number[] = [];
  let n = Math.ceil(Math.log2(minFreq / C0));
  for (;;) {
    const f = C0 * Math.pow(2, n);
    if (f > maxFreq) break;
    if (f >= minFreq) ticks.push(f);
    n++;
  }
  return ticks;
}

export function formatTickLabel(freq: number): string {
  return `${Math.round(freq)} Hz (${noteNameForFrequency(freq)})`;
}
