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

// Filter code for a word's own POS, or undefined for kinds with no code
// (prepositions, articles, ...) — undefined means "use all entries".
export function posFilter(type: string): string | undefined {
  return POS_CODES[type.toLowerCase()];
}

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
export interface WordEntry {
  type: string;
  thai: string[];
}

// Core fields every row carries, raw or normalized — spelled once so the
// shapes below can never drift apart on them.
interface WordRow {
  word: string;
  type: string;
  level: string;
  ox3000: boolean;
  ox5000: boolean;
}

// One row as the scrapper emits it: a headword repeated once per part of
// speech. Older artifacts used `pronounce` before `pronounceURL`, and
// definition/examples only exist if the scrape ever adds them — everything
// beyond the core fields is optional so any words.json parses.
export interface RawWord extends WordRow {
  pronounceURL?: string;
  pronounce?: string;
  definition?: string | string[];
  definitions?: string | string[];
  example?: string | string[];
  examples?: string | string[];
}

// A normalized row: one pronounceURL plus the optional prompt-only context
// translators attach (definition/examples). These extras are never persisted —
// translator output strips them before writing the runtime files.
export interface OxWord extends WordRow {
  pronounceURL: string;
  definition?: string;
  examples?: string[];
}

// The runtime word row: an OxWord plus its per-POS Thai entries. Re-exported
// as Word by src/game/types.ts and reused as-is by both translators.
export interface Word extends OxWord {
  entries: WordEntry[];
}

function normalizeList(value?: string | string[]): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value])
    .map((v) => String(v).trim())
    .filter(Boolean);
}

// Collapses a raw scrapper row into a Word: pronounce fallback, plural field
// spellings (definition/definitions, example/examples) merged. entries is the
// empty placeholder each translator fills in after translating.
export function normalizeRawWord(r: RawWord): Word {
  return {
    word: r.word,
    type: r.type,
    level: r.level,
    ox3000: r.ox3000,
    ox5000: r.ox5000,
    pronounceURL: r.pronounceURL ?? r.pronounce ?? "-",
    definition:
      normalizeList(r.definition ?? r.definitions).join("; ") || undefined,
    examples: normalizeList(r.example ?? r.examples),
    entries: [],
  };
}
