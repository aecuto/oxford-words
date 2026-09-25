import type { WordList } from "../lib/gameConfig";

// Player's word-list choice, persisted in localStorage so every pool reader
// (lobby, solo, room join, /words) follows the same selection without props.
// Fails soft to "3000" when storage is unavailable — SSR, the smoke script,
// private mode — mirroring the SRS stats helpers in wordProgress.ts.
const KEY = "words:list:v1";

export function loadWordList(): WordList {
  try {
    return window.localStorage.getItem(KEY) === "5000" ? "5000" : "3000";
  } catch {
    return "3000";
  }
}

export function saveWordList(list: WordList): void {
  try {
    window.localStorage.setItem(KEY, list);
  } catch {
    // storage unavailable; the choice lives only for this session's UI
  }
}
