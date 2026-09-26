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

export type Hit = {
  wordIndex: number;
  damage: number;
  crit: boolean;
  at: number;
};

export type LastAnswer = {
  wordIndex: number;
  answer: string;
  correct: boolean;
  at: number;
};

export type AnswerState = "idle" | "correct" | "wrong" | "timeout";

export type PlayerSlot = {
  uid: string;
  name: string;
  streak: number;
  hits: Hit[];
  lastAnswer: LastAnswer | null;
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

export type Popup = {
  id: number;
  side: "me" | "opp";
  damage: number;
  crit: boolean;
};
