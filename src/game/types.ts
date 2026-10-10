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

// Self-paced turn state: each player walks the shared word list at their
// own speed — wordIndex points at their current word and turnStartedAt is
// when it was dealt to them (no waiting for the opponent between words).
export type PlayerSlot = {
  uid: string;
  name: string;
  wordIndex: number;
  turnStartedAt: Timestamp | null;
  lastAnswer: LastAnswer | null;
  // Indices of words this player answered correctly / incorrectly — the
  // per-word history that feeds the pips and the judge-by-count finish.
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

export type ClientRoom = Omit<RoomDoc, "players"> & {
  players: Record<SlotKey, Omit<PlayerSlot, "turnStartedAt"> & { turnStartedAt: number | null } | null>;
};
