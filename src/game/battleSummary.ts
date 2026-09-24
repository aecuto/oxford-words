export type BattleWordDetail = {
  word: string;
  /** part of speech, e.g. "noun" | "verb" */
  type?: string;
  pronounce?: string;
  /** correct answer (Thai translation) */
  answer?: string;
  correct: boolean;
  /** HP you dealt to the opponent on this word */
  dealt: number;
  /** HP you lost on this word (miss penalty or opponent hits) */
  taken: number;
};

export type BattleSummary = {
  outcome: "win" | "lose" | "draw";
  mode: "solo" | "room";
  difficulty?: "easy" | "hard";
  opponent?: string;
  roomCode?: string;
  total: number;
  answered: number;
  correct: number;
  bestStreak: number;
  damageDealt: number;
  damageTaken: number;
  words: BattleWordDetail[];
};

const KEY = "battle:summary:v2";

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
