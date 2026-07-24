export interface VowelReference {
  symbol: string;
  label: string;
  f1: number;
  f2: number;
}

/** Approximate average adult American English vowel formants (Hz), after Hillenbrand et al. 1995. */
export const VOWEL_CHART: VowelReference[] = [
  { symbol: "i", label: "ee (beet)", f1: 270, f2: 2290 },
  { symbol: "ɪ", label: "ih (bit)", f1: 390, f2: 1990 },
  { symbol: "ɛ", label: "eh (bet)", f1: 530, f2: 1840 },
  { symbol: "æ", label: "ae (bat)", f1: 660, f2: 1720 },
  { symbol: "ɑ", label: "ah (bot)", f1: 730, f2: 1090 },
  { symbol: "ɔ", label: "aw (bought)", f1: 570, f2: 840 },
  { symbol: "ʊ", label: "uh (book)", f1: 440, f2: 1020 },
  { symbol: "u", label: "oo (boot)", f1: 300, f2: 870 },
  { symbol: "ʌ", label: "uh (but)", f1: 640, f2: 1190 },
  { symbol: "ə", label: "schwa (about)", f1: 500, f2: 1500 },
];

/** Nearest-neighbor vowel classification in (F1, F2) space. Approximate, not diagnostic. */
export function classifyVowel(f1: number, f2: number): VowelReference | null {
  let best: VowelReference | null = null;
  let bestDist = Infinity;
  for (const candidate of VOWEL_CHART) {
    const dist = Math.hypot(f1 - candidate.f1, f2 - candidate.f2);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

export interface CornerVowelPoint {
  symbol: string;
  f1: number;
  f2: number;
}

/**
 * Adult male/female averages for the four "corner" vowels that bound the vowel space
 * (Peterson & Barney 1952 / Hillenbrand et al. 1995 — the same normative dataset VOWEL_CHART is
 * drawn from). These are POPULATION AVERAGES with substantial overlap between groups — a
 * reference range to compare against, not a category any individual voice must fall into.
 */
export const MASCULINE_CORNER_VOWELS: CornerVowelPoint[] = [
  { symbol: "i", f1: 342, f2: 2322 },
  { symbol: "æ", f1: 588, f2: 1952 },
  { symbol: "ɑ", f1: 768, f2: 1333 },
  { symbol: "u", f1: 378, f2: 997 },
];

export const FEMININE_CORNER_VOWELS: CornerVowelPoint[] = [
  { symbol: "i", f1: 437, f2: 2761 },
  { symbol: "æ", f1: 669, f2: 2349 },
  { symbol: "ɑ", f1: 936, f2: 1551 },
  { symbol: "u", f1: 459, f2: 1105 },
];
