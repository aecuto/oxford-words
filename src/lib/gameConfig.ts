export const MAX_HP = 100;

export const TURN_MS = 10_000;
export const TURN_GRACE_MS = 1_500;

export const WORDS_PER_BATTLE = 20;
export const MAX_WORDS_PER_ROOM = 30;

// Word list the game plays with ("3000" or "5000"). The player's pick is
// persisted in localStorage via src/game/wordList.ts; this type anchors the
// two valid file names (words.<list>.th.json).
export type WordList = "3000" | "5000";

// The 2-option decision rule on the battle screen: every word shows the
// correct meaning plus one distractor, so the pick is a clean binary call —
// instant recall vs hesitate/guess.
export const ANSWER_OPTIONS = 2;

export const DAILY_GOAL_CORRECT = WORDS_PER_BATTLE;

// One calendar day in ms — shared by every ivl/due computation
// (wordProgress, wordPool, the /words page, the smoke script).
export const DAY_MS = 86_400_000;

// Default display names when a player hasn't picked one.
export const DEFAULT_PLAYER_NAMES = {
  p1: "Player 1",
  p2: "Player 2",
} as const;

export const POPUP_LIFETIME_MS = 1_100;

export const DAMAGE = {
  high: 6,
  medium: 5,
  low: 4,
} as const;

export const CRIT_MULTIPLIER = 2;
export const STREAK_FOR_CRIT = 3;

// The price of a wrong answer in every mode: PvP players pay it as a penalty
// hit, and the solo bot pays the same price on its own misses (SOLO_BOT.hit
// anchors to this value — the bot itself lives in src/game/botBrain.ts).
export const WRONG_ANSWER_HIT = 5;

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
