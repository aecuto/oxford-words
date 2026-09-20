import {
  arrayUnion,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentReference,
  type Unsubscribe,
} from "firebase/firestore";
import {
  COLLECTION,
  MAX_WORDS_PER_ROOM,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LEN,
} from "../lib/gameConfig";
import { getFirebase } from "../lib/firebase";
import type { BattleWord, Hit, LastAnswer, RoomDoc, SlotKey, Winner } from "./types";
import type { ClientRoom, PlayerSlot } from "./types";

function roomRef(code: string) {
  const { fs } = getFirebase();
  return doc(fs, COLLECTION, code) as DocumentReference<RoomDoc>;
}

function randomCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LEN; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

function newSlot(uid: string, name: string, words: BattleWord[]): PlayerSlot {
  return { uid, name, streak: 0, hits: [], lastAnswer: null, words };
}

function toClientRoom(data: RoomDoc | undefined): ClientRoom | null {
  if (!data) return null;
  const ts = data.turnStartedAt as unknown as { toMillis?: () => number } | null;
  return {
    ...data,
    turnStartedAt: typeof ts?.toMillis === "function" ? ts.toMillis() : null,
  };
}

export async function createRoom(
  uid: string,
  name: string,
  words: BattleWord[]
): Promise<string> {
  const sliced = words.slice(0, MAX_WORDS_PER_ROOM);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const ref = roomRef(code);
    const existing = await getDoc(ref);
    if (existing.exists()) continue;
    const room: RoomDoc = {
      code,
      hostUid: uid,
      status: "waiting",
      words: sliced,
      wordIndex: 0,
      turnStartedAt: null,
      players: { p1: newSlot(uid, name, []), p2: null },
      winner: null,
    };
    await setDoc(ref, room);
    return code;
  }
  throw new Error("Could not allocate a free room code, try again");
}

export async function getRoom(code: string): Promise<ClientRoom | null> {
  const snap = await getDoc(roomRef(code));
  return toClientRoom(snap.data());
}

export function subscribeRoom(
  code: string,
  onChange: (room: ClientRoom | null) => void
): Unsubscribe {
  return onSnapshot(roomRef(code), (snap) =>
    onChange(toClientRoom(snap.data({ serverTimestamps: "estimate" })))
  );
}

export async function joinRoom(
  code: string,
  uid: string,
  name: string,
  words: BattleWord[]
): Promise<void> {
  await updateDoc(roomRef(code), {
    "players.p2": newSlot(uid, name, words),
  });
}

export async function startGame(code: string, words: BattleWord[]): Promise<void> {
  await updateDoc(roomRef(code), {
    words,
    status: "playing",
    turnStartedAt: serverTimestamp(),
  });
}

export async function submitAnswer(
  code: string,
  key: SlotKey,
  lastAnswer: LastAnswer,
  hit: Hit | null,
  streak: number
): Promise<void> {
  const update: Record<string, unknown> = {
    [`players.${key}.lastAnswer`]: lastAnswer,
    [`players.${key}.streak`]: streak,
  };
  if (hit) {
    update[`players.${key}.hits`] = arrayUnion(hit);
  }
  await updateDoc(roomRef(code), update);
}

export async function advanceWord(code: string, nextIndex: number): Promise<void> {
  await updateDoc(roomRef(code), {
    wordIndex: nextIndex,
    turnStartedAt: serverTimestamp(),
  });
}

export async function endGame(code: string, winner: Winner): Promise<void> {
  await updateDoc(roomRef(code), {
    status: "ended",
    winner,
  });
}
