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

export type SoloBotConfig = {
  name: string;
  hp: number;
  hit: number;
  accuracy: number;
  minThinkMs: number;
  maxThinkMs: number;
};

// One bot for solo mode. It thinks faster than HIGH_MS, so
// computeHit(thinkMs, streak) lands every answer in the top damage tier with
// streak crits — it grinds ~6 per word, so the player dies around word 17-18
// and the only way to win is to out-race it to the KO. The race stays winnable
// because 0.85 accuracy means ~3 misses per battle and its misses cost it
// WRONG_ANSWER_HIT (~15 free HP off the KO bar). Answer everything under
// HIGH_MS and keep the every-4th-answer crit alive to KO it by word 16-17;
// two player misses blow the tempo and the race is lost. hp 130 keeps the
// battle long enough that every word still feeds the SRS loop.
export const SOLO_BOT: SoloBotConfig = {
  name: "BOT",
  hp: 130,
  hit: 5,
  accuracy: 0.85,
  minThinkMs: 900,
  maxThinkMs: 3_400,
};

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
