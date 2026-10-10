import type { Timestamp } from "firebase/firestore";

// The word row shape is defined once in wordData.ts (shared with the
// translators); re-exported here so runtime imports stay on ./types.
export type { Word } from "./wordData";

export type ResultOutcome = "win" | "lose" | "draw";

export type BattleWord = {
  word: string;
  type: string;
  level: string;
  pronounceURL: string;
  correctAnswer: string;
  options: string[];
};

export type LastAnswer = {
  wordIndex: number;
  answer: string;
  correct: boolean;
  at: number;
};

export type AnswerState = "idle" | "correct" | "wrong" | "timeout";

// A board cell is empty or holds one player's mark ("X" = p1, "O" = p2).
export type Cell = "" | "X" | "O";

// One placement on the Infinite Tic-Tac-Toe board, in chronological order —
// the per-slot prefix of this list is what makes "oldest mark fades" exact.
export type Move = {
  slot: SlotKey;
  cell: number;
  wordIndex: number;
};

export type PlayerSlot = {
  uid: string;
  name: string;
  lastAnswer: LastAnswer | null;
  // Indices of words this player answered correctly / incorrectly — the
  // per-word history hits[] used to provide, now that a miss leaves no mark.
  // correctIdx also decides a judge-by-count finish when the words run out.
  correctIdx: number[];
  wrongIdx: number[];
  words: BattleWord[];
};

export type SlotKey = "p1" | "p2";

export type RoomStatus = "waiting" | "playing" | "ended";

export type Winner = "p1" | "p2" | "draw";

export type RoomDoc = {
  code: string;
  hostUid: string;
  status: RoomStatus;
  words: BattleWord[];
  wordIndex: number;
  turnStartedAt: Timestamp | null;
  board: Cell[];
  moves: Move[];
  players: Record<SlotKey, PlayerSlot | null>;
  winner: Winner | null;
  rematchReady?: Record<SlotKey, boolean>;
  createdAt?: Timestamp | null;
  heartbeat?: Timestamp | null;
};

export type OpenRoom = {
  code: string;
  host: string;
  hostUid: string;
  createdAt: number;
};

export type ClientRoom = Omit<RoomDoc, "turnStartedAt"> & {
  turnStartedAt: number | null;
};
