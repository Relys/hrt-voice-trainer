export interface ExerciseDefinition {
  id: string;
  title: string;
  instructions: string;
  durationSec: number;
}

export const EXERCISES: ExerciseDefinition[] = [
  {
    id: "vowel-i",
    title: 'Sustained Vowel — /i/ ("ee")',
    instructions: 'Take a breath and sustain an "ee" vowel steadily.',
    durationSec: 5,
  },
  {
    id: "vowel-a",
    title: 'Sustained Vowel — /a/ ("ah")',
    instructions: 'Take a breath and sustain an "ah" vowel steadily.',
    durationSec: 5,
  },
  {
    id: "sentence",
    title: "Sentence Practice",
    instructions: "Read a sentence of your choice naturally, at a comfortable pace.",
    durationSec: 15,
  },
  {
    id: "pitch-glide",
    title: "Pitch Glide",
    instructions:
      "Starting at your lowest comfortable pitch, glide smoothly up to your highest, then back down. Keep it connected — no breaks or register flips.",
    durationSec: 10,
  },
  {
    id: "twang-focus",
    title: "Resonance / Twang Focus",
    instructions:
      'Sustain a bright "ng" or "ee" sound, watching the Ring/Twang readout below — aim to keep it climbing without straining.',
    durationSec: 8,
  },
  {
    id: "target-hold",
    title: "Target Range Hold",
    instructions:
      "Speak or hum steadily, trying to keep your pitch inside your target range the whole time. Set a target range in Settings first if you haven't.",
    durationSec: 10,
  },
];
