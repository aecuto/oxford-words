// Word-data rules shared by the runtime pool and the translators (runtime +
// build tools must never drift apart on these, so they live here and are
// imported — not copied — everywhere).
//
// --- POS → entry-type codes ---
// The source data labels a row with a part of speech ("verb", "noun", ...);
// entry types must prefix-match these codes so getCorrectAnswer can filter a
// word's entries by its own POS.
export const POS_CODES: Record<string, string> = {
  noun: "N",
  verb: "V",
  adjective: "ADJ",
  adverb: "ADV",
};

// Label used to TYPE a produced entry; unusual kinds fall back to their raw
// POS uppercased so every entry still carries a stable code.
export function posCode(type: string): string {
  return POS_CODES[type.toLowerCase()] ?? type.toUpperCase();
}

// Keep one entry per headword, preferring the ox3000-flagged copy. The
// scrapper emits one row per part of speech, so anything fed through here is
// safe to deal without repeating a headword.
export function dedupeByHeadword<T extends { word: string; ox3000: boolean }>(
  words: T[],
): T[] {
  const byWord = new Map<string, T>();
  for (const w of words) {
    const prev = byWord.get(w.word);
    if (!prev || (!prev.ox3000 && w.ox3000)) byWord.set(w.word, w);
  }
  return [...byWord.values()];
}

// --- scrapper row types + normalization ---
// One row exactly as the scrapper's words.json emits it: a headword repeated
// once per part of speech, pronounceURL always present ("-" when missing).
export interface WordRow {
  word: string;
  type: string;
  level: string;
  ox3000: boolean;
  ox5000: boolean;
  pronounceURL: string;
}

// The runtime word row: a scrapper row plus the flat answer string for the
// row's own POS ("present" verb → นำเสนอ, noun → ของขวัญ — resolved at build
// time by resolveThai, so no nested entries ship to the browser). Re-exported
// as Word by src/game/types.ts and reused as-is by both translators.
export interface Word extends WordRow {
  thai: string;
}

// Lifts a scrapper row into a Word; thai is the empty placeholder each
// translator fills in with resolveThai after translating.
export function normalizeWord(r: WordRow): Word {
  return { ...r, thai: "" };
}

// Flattens a row's per-POS translations (category → thai list, insertion
// order preserved) into the answer string the runtime quizzes on: the row's
// own POS first (up to 3 uniq translations), else the first translation of
// any category. Shared by both translators so their flat output can't drift.
export function resolveThai(
  type: string,
  thaiByType: Map<string, string[]>
): string {
  const code = POS_CODES[type.toLowerCase()];
  const picked: string[] = [];
  for (const [cat, list] of thaiByType) {
    if (!code || cat.startsWith(code)) picked.push(...list);
  }
  const uniqThai = [...new Set(picked)];
  if (uniqThai.length > 0) return uniqThai.slice(0, 3).join(", ");
  return [...thaiByType.values()].flat()[0] || "";
}
