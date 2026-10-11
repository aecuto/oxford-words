import type { ResultOutcome } from "./types";

export type BattleWordDetail = {
  word: string;
  /** part of speech, e.g. "noun" | "verb" */
  type?: string;
  pronounceURL?: string;
  /** correct answer (Thai translation) */
  answer?: string;
  correct: boolean;
  /** graded instant (<2s) → mastered; absent when timing is unavailable (PvP) */
  instant?: boolean;
};

export type BattleSummary = {
  outcome: ResultOutcome;
  mode: "solo" | "room";
  opponent?: string;
  roomCode?: string;
  total: number;
  answered: number;
  correct: number;
  words: BattleWordDetail[];
};

const KEY = "battle:summary:v3";

export function saveBattleSummary(summary: BattleSummary): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(summary));
  } catch {
    // storage unavailable; the result page falls back to URL params
  }
}

export function loadBattleSummary(): BattleSummary | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BattleSummary;
    if (
      parsed &&
      (parsed.outcome === "win" ||
        parsed.outcome === "lose" ||
        parsed.outcome === "draw") &&
      (parsed.mode === "solo" || parsed.mode === "room") &&
      Array.isArray(parsed.words)
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

// Recent battles' full word lists (localStorage): the exclusion horizon for
// the next deal. One battle is not enough — the SRS old-slot draw takes the
// least-recently-seen due words first, so with only the previous game held
// out the same words cycle straight back every other "play again".
const RECENT_KEY = "battle:recent:v1";
const RECENT_BATTLES = 3;

export function saveRecentBattleWords(words: string[]): void {
  try {
    if (!words.length) return;
    const next = [words, ...loadRecentBattles()].slice(0, RECENT_BATTLES);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable: the one-battle summary exclusion still applies
  }
}

function loadRecentBattles(): string[][] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter((b): b is string[] => Array.isArray(b))
      : [];
  } catch {
    return [];
  }
}

// Union of the last RECENT_BATTLES battles' words — pass this as the
// exclude list when picking the next deal.
export function loadRecentBattleWords(): string[] {
  const seen = new Set<string>();
  for (const battle of loadRecentBattles()) {
    for (const w of battle) seen.add(w);
  }
  return [...seen];
}
