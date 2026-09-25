export const MAX_HP = 100;

export const TURN_MS = 10_000;
export const TURN_GRACE_MS = 1_500;

export const WORDS_PER_BATTLE = 20;
export const MAX_WORDS_PER_ROOM = 30;

// The 2-option decision rule on the battle screen: every word shows the
// correct meaning plus one distractor, so the pick is a clean binary call —
// instant recall vs hesitate/guess.
export const ANSWER_OPTIONS = 2;

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
  // Answers most words like a real player with medium-pace hits, but its
  // misses are free (only the hard bot pays for them), so the race is fair.
  accuracy: 0.7,
  minThinkMs: 2_200,
  maxThinkMs: 6_500,
};

// Hard bot answers almost every word and thinks faster than HIGH_MS, so
// computeHit(thinkMs, streak) lands every answer in the top damage tier with
// streak crits, and its rare misses still cost it WRONG_ANSWER_HIT. The extra
// HP means you must out-race it to the KO, not out-last it.
export const SOLO_BOT_HARD: SoloBotConfig = {
  name: "PROF",
  hp: 140,
  hit: SOLO_BOT.hit,
  accuracy: 0.9,
  minThinkMs: 1_000,
  maxThinkMs: 3_800,
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

// The 2-option decision rule for the SRS pools (src/game/wordProgress.ts):
// a correct answer faster than ANSWER_INSTANT_MS masters the word (Pool C);
// anything slower, a guess, a wrong pick or a timeout grades as "retry" and
// stays in Pool B for active review. Instant sits at 2s so a deliberate
// read-and-compare on the 2-option grid still counts as hesitant — at 1s the
// Mastered counter stayed pinned at zero.
export const ANSWER_INSTANT_MS = 2_000;
