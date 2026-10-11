export const WORDS_PER_BATTLE = 20;

// One battle is WORDS_PER_BATTLE words, hard-capped: a PvP room's shared set
// is both players' picks interleaved down to this count (roomWordSet), and
// when the words run out with no 3-in-a-row on the board the game is a
// draw — no top-up from the pool, no judging by correct-answer counts.

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

// Infinite Tic-Tac-Toe: PLACEMENT_STREAK consecutive correct answers earn
// one mark placement (X or O) on the shared 3x3 board; 3 in a row wins. A
// wrong or timed-out word resets the run. Each side may hold at most
// MARKS_PER_PLAYER marks — placing one more removes their oldest, so the
// board can never clog and the game can never end in a board draw.
export const MARKS_PER_PLAYER = 3;

// Correct answers only pay off in runs: every PLACEMENT_STREAK consecutive
// correct answers earns exactly one placement (a 6-streak pays two). This
// gates the board behind real recall instead of a coin-flip on a 2-option
// grid, and keeps WORDS_PER_BATTLE from filling the board with marks.
export const PLACEMENT_STREAK = 3;

export const COLLECTION = "oxfordwords_rooms";
export const PROGRESS_COLLECTION = "oxfordwords_progress";

export const ROOM_CODE_LEN = 4;
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

// The 2-option decision rule for the SRS pools (src/game/wordProgress.ts):
// a correct answer faster than ANSWER_INSTANT_MS masters the word (Pool C);
// anything slower, a guess, a wrong pick or a timeout grades as "retry" and
// stays in Pool B for active review. Instant sits at 2s so a deliberate
// read-and-compare on the 2-option grid still counts as hesitant — at 1s the
// Mastered counter stayed pinned at zero.
export const ANSWER_INSTANT_MS = 2_000;
