// Shared bits of the two-phase AI translator: cache.ts fills ai-cache.json
// from Gemini, map.ts turns that journal into the flat runtime files. The
// paths and the word+POS cache key live here so the phases can't drift.
import path from "path";
import { posCode } from "../../../src/game/wordData";

export const WORDS_PATH = path.resolve(__dirname, "../../scrapper/words.json");
export const CACHE_PATH = path.resolve(__dirname, "ai-cache.json");

// One cache entry per word+POS pair ("present|V", "present|N") — POS-specific
// prompts mean the same headword translates differently per type.
export const key = (w: { word: string; type: string }) =>
  `${w.word.toLowerCase()}|${posCode(w.type)}`;
