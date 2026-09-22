export const MAX_HP = 100;

export const TURN_MS = 10_000;
export const TURN_GRACE_MS = 1_500;

export const WORDS_PER_BATTLE = 20;
export const MAX_WORDS_PER_ROOM = 30;

export const DAILY_GOAL_CORRECT = WORDS_PER_BATTLE;

export const POPUP_LIFETIME_MS = 1_100;

export const DAMAGE = {
  high: 6,
  medium: 5,
  low: 4,
} as const;

export const CRIT_MULTIPLIER = 2;
export const STREAK_FOR_CRIT = 3;

export type SoloDifficulty = "easy" | "hard";

export type SoloBotConfig = {
  name: string;
  hp: number;
  hit: number;
  accuracy: number;
  minThinkMs: number;
  maxThinkMs: number;
};

export const SOLO_BOT: SoloBotConfig = {
  name: "BOT",
  hp: 120,
  // Miss penalty: MAX_HP / hit = 20, so a battle always plays all 20 words
  // and every answer feeds the SRS loop; skilled runs can still KO the bot.
  hit: 5,
  // Occasionally answers back with slow, low-tier hits (~1 in 10 words).
  accuracy: 0.1,
  minThinkMs: 4_000,
  maxThinkMs: 8_500,
};

// Hard bot answers every word like a real player: computeHit(thinkMs, streak)
// decides its damage tier/crits, and its own misses cost it WRONG_ANSWER_HIT.
// Tuned so a 75%-correct player wins ~1 of 3 battles and experts ~9 of 10.
export const SOLO_BOT_HARD: SoloBotConfig = {
  name: "PROF",
  hp: 120,
  hit: SOLO_BOT.hit,
  accuracy: 0.7,
  minThinkMs: 2_200,
  maxThinkMs: 6_500,
};

export function botConfigFor(difficulty: SoloDifficulty): SoloBotConfig {
  return difficulty === "hard" ? SOLO_BOT_HARD : SOLO_BOT;
}

export const WRONG_ANSWER_HIT = SOLO_BOT.hit;

export const COLLECTION = "oxfordwords_rooms";
export const PROGRESS_COLLECTION = "oxfordwords_progress";

export const ROOM_CODE_LEN = 4;
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const HIGH_MS = 4_000;
export const MEDIUM_MS = 7_000;
