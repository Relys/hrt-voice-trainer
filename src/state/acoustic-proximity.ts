import { FEMININE_CORNER_VOWELS, MASCULINE_CORNER_VOWELS } from "../dsp/vowel.ts";
import { TARGET_RANGE_PRESETS } from "./view-settings.ts";

export type ProximityCategory = "masculine" | "androgynous" | "feminine";

export interface AcousticProximity {
  /** Raw 0-1 position along the masculine(0)<->feminine(1) axis before the 3-way breakdown below
   *  — kept for the trend sparkline/session average, since a single continuous number is what a
   *  line chart needs. Not shown directly as a standalone percent anymore: a lone "43%" doesn't
   *  say 43% of *what*, which is exactly the ambiguity the masculinePct/androgynousPct/femininePct
   *  breakdown below is meant to fix. */
  value: number;
  /** Three percentages that always sum to ~100 — a triangular-membership breakdown of `value`
   *  against all three reference points (masculine=0, androgynous=0.5, feminine=1), not just a
   *  two-point scale. androgynous is the midpoint between the two published reference clusters,
   *  not a separately published data point of its own (there isn't one in the source literature). */
  masculinePct: number;
  androgynousPct: number;
  femininePct: number;
  /** Whichever of the three has the highest membership — a strict consequence of the percentages
   *  above (argmax), not a separately chosen threshold. */
  category: ProximityCategory;
  /** How much the pitch-based and formant-based sub-scores agree with each other (1 = identical,
   *  0 = maximally opposed), as a fraction. Null when only one of the two cues was available this
   *  frame, since agreement can't be measured from a single number. This is NOT a model's
   *  confidence in a prediction — it's a disclosed measure of internal consistency between the
   *  two acoustic cues this panel actually computes from. */
  confidence: number | null;
}

function centroid(points: ReadonlyArray<{ f1: number; f2: number }>): { f1: number; f2: number } {
  const f1 = points.reduce((a, b) => a + b.f1, 0) / points.length;
  const f2 = points.reduce((a, b) => a + b.f2, 0) / points.length;
  return { f1, f2 };
}

const MASC_FORMANT_CENTROID = centroid(MASCULINE_CORNER_VOWELS);
const FEM_FORMANT_CENTROID = centroid(FEMININE_CORNER_VOWELS);

// Midpoints of the same masculine/feminine pitch bands already used for target-range shading.
const MASC_PITCH_HZ = (TARGET_RANGE_PRESETS.masculine[0] + TARGET_RANGE_PRESETS.masculine[1]) / 2;
const FEM_PITCH_HZ = (TARGET_RANGE_PRESETS.feminine[0] + TARGET_RANGE_PRESETS.feminine[1]) / 2;

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

/** Standard triangular-membership partition of three ordered categories over t in [0,1], with
 *  masculine peaking at t=0, androgynous at t=0.5, feminine at t=1. Always sums to 1. */
function triangularMembership(t: number): { masculine: number; androgynous: number; feminine: number } {
  const masculine = clamp01(1 - t / 0.5);
  const feminine = clamp01((t - 0.5) / 0.5);
  const androgynous = clamp01(1 - masculine - feminine);
  return { masculine, androgynous, feminine };
}

/**
 * Averages up to two independent 0-1 sub-scores:
 *  - pitch's linear position between the masculine- and feminine-typical band midpoints
 *  - (F1,F2)'s position projected onto the line connecting the masculine and feminine
 *    corner-vowel centroids (the same reference clusters the Vowel Chart's M/F mode plots)
 * Returns null if neither pitch nor a full formant pair is available this frame.
 */
export function computeAcousticProximity(pitchHz: number | null, f1: number | null, f2: number | null): AcousticProximity | null {
  const scores: number[] = [];

  if (pitchHz !== null) {
    scores.push(clamp01((pitchHz - MASC_PITCH_HZ) / (FEM_PITCH_HZ - MASC_PITCH_HZ)));
  }

  if (f1 !== null && f2 !== null) {
    const dx = FEM_FORMANT_CENTROID.f2 - MASC_FORMANT_CENTROID.f2;
    const dy = FEM_FORMANT_CENTROID.f1 - MASC_FORMANT_CENTROID.f1;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq > 0 ? ((f2 - MASC_FORMANT_CENTROID.f2) * dx + (f1 - MASC_FORMANT_CENTROID.f1) * dy) / lenSq : 0.5;
    scores.push(clamp01(t));
  }

  if (scores.length === 0) return null;
  const value = scores.reduce((a, b) => a + b, 0) / scores.length;
  const { masculine, androgynous, feminine } = triangularMembership(value);
  const category: ProximityCategory =
    masculine >= androgynous && masculine >= feminine ? "masculine" : feminine >= androgynous ? "feminine" : "androgynous";
  const confidence = scores.length === 2 ? clamp01(1 - Math.abs(scores[0] - scores[1])) : null;
  return { value, masculinePct: masculine, androgynousPct: androgynous, femininePct: feminine, category, confidence };
}
