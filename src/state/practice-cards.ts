export type PracticeCardLevel = "word" | "phrase" | "sentence" | "story";

export interface PracticeCard {
  id: string;
  text: string;
  level: PracticeCardLevel;
  /** Built-in cards can't be edited/deleted, only custom ones — mirrors the "default sets are
   *  read-only, custom sets are yours" split described for GenderFluent's Practice Cards. */
  custom: boolean;
}

export const PRACTICE_CARD_LEVELS: PracticeCardLevel[] = ["word", "phrase", "sentence", "story"];

export const PRACTICE_CARD_LEVEL_LABELS: Record<PracticeCardLevel, string> = {
  word: "Words",
  phrase: "Phrases",
  sentence: "Sentences",
  story: "Short Stories",
};

/** Original neutral content spanning a range of vowels/resonance, not tied to any copyrighted
 *  or clinical passage — read-only, same as GenderFluent's default (non-editable) card sets. */
export const DEFAULT_CARDS: PracticeCard[] = [
  { id: "word-1", text: "Hello", level: "word", custom: false },
  { id: "word-2", text: "Rainbow", level: "word", custom: false },
  { id: "word-3", text: "Sunshine", level: "word", custom: false },
  { id: "word-4", text: "Butterfly", level: "word", custom: false },
  { id: "word-5", text: "Wonderful", level: "word", custom: false },

  { id: "phrase-1", text: "Good morning, everyone.", level: "phrase", custom: false },
  { id: "phrase-2", text: "How are you doing today?", level: "phrase", custom: false },
  { id: "phrase-3", text: "Thank you so much for coming.", level: "phrase", custom: false },
  { id: "phrase-4", text: "See you later, take care.", level: "phrase", custom: false },

  { id: "sentence-1", text: "The weather is absolutely beautiful today.", level: "sentence", custom: false },
  { id: "sentence-2", text: "I really enjoy walking through the park in the morning.", level: "sentence", custom: false },
  { id: "sentence-3", text: "Could you help me find my keys? I think I left them upstairs.", level: "sentence", custom: false },
  { id: "sentence-4", text: "She sells seashells down by the seashore every summer.", level: "sentence", custom: false },

  {
    id: "story-1",
    text: "It was a bright and sunny morning. Maria walked along the beach, listening to the waves roll in one after another. She felt calm and hopeful, ready to start a new day full of possibilities.",
    level: "story",
    custom: false,
  },
  {
    id: "story-2",
    text: "The old library on Main Street had always been my favorite place. Rows of tall wooden shelves stretched toward the ceiling, and the smell of old paper filled the quiet air. I could spend hours there and never notice the time passing.",
    level: "story",
    custom: false,
  },
];

const CUSTOM_CARDS_KEY = "hrt-voice-trainer:custom-cards";

export function loadCustomCards(): PracticeCard[] {
  try {
    const raw = localStorage.getItem(CUSTOM_CARDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCustomCards(cards: PracticeCard[]): boolean {
  try {
    localStorage.setItem(CUSTOM_CARDS_KEY, JSON.stringify(cards));
    return true;
  } catch {
    return false;
  }
}

export function addCustomCard(text: string, level: PracticeCardLevel): PracticeCard | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const card: PracticeCard = { id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text: trimmed, level, custom: true };
  const cards = [...loadCustomCards(), card];
  return saveCustomCards(cards) ? card : null;
}

export function deleteCustomCard(id: string): boolean {
  const cards = loadCustomCards().filter((c) => c.id !== id);
  return saveCustomCards(cards);
}

export function listAllCards(): PracticeCard[] {
  return [...DEFAULT_CARDS, ...loadCustomCards()];
}
