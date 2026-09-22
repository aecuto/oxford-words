import {
  arrayUnion,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
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
  WORDS_PER_BATTLE,
} from "../lib/gameConfig";
import { getFirebase } from "../lib/firebase";
import { mergeWordLists } from "./wordPool";
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
      rematchReady: { p1: false, p2: false },
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

export async function renamePlayer(
  code: string,
  key: SlotKey,
  name: string
): Promise<void> {
  const fallback = key === "p1" ? "Player 1" : "Player 2";
  await updateDoc(roomRef(code), {
    [`players.${key}.name`]: name.trim().slice(0, 16) || fallback,
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
  streak: number,
  oppHit: Hit | null = null
): Promise<void> {
  const oppKey: SlotKey = key === "p1" ? "p2" : "p1";
  const update: Record<string, unknown> = {
    [`players.${key}.lastAnswer`]: lastAnswer,
    [`players.${key}.streak`]: streak,
  };
  if (hit) {
    update[`players.${key}.hits`] = arrayUnion(hit);
  }
  if (oppHit) {
    update[`players.${oppKey}.hits`] = arrayUnion(oppHit);
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

// Rematch on the same code, gated on BOTH players pressing Play again.
// Each click marks that player ready (status stays "ended" meanwhile so the
// battle screen keeps rendering until the rematch is mutual). When the second
// player clicks, this transaction resets state, merges both players' fresh
// word lists and flips straight into "playing" — both room pages (each player
// navigates back here after clicking) see the new battle at the same time.
export async function rematchRoom(
  code: string,
  uid: string,
  words: BattleWord[]
): Promise<void> {
  const sliced = words.slice(0, MAX_WORDS_PER_ROOM);
  const { fs } = getFirebase();
  const ref = roomRef(code) as DocumentReference<RoomDoc>;
  await runTransaction(fs, async (tx) => {
    const snap = await tx.get(ref);
    const room = snap.data();
    if (!room) return;
    const slotKey: SlotKey | null =
      room.players.p1?.uid === uid
        ? "p1"
        : room.players.p2?.uid === uid
          ? "p2"
          : null;
    if (!slotKey) return;
    if (room.status === "playing") return;
    if (room.status !== "ended") return;

    const oppKey: SlotKey = slotKey === "p1" ? "p2" : "p1";
    const myReady = { ...(room.rematchReady ?? { p1: false, p2: false }) };
    myReady[slotKey] = true;
    const oppReady = myReady[oppKey];
    const oppPresent = room.players[oppKey] != null;

    if (!oppReady || !oppPresent) {
      // First player in — just mark ready and wait for the other.
      tx.update(ref, {
        [`rematchReady.${slotKey}`]: true,
        [`players.${slotKey}.words`]: sliced,
      });
      return;
    }

    // Both ready — reset and start immediately.
    const p1Words =
      room.players.p1?.words && room.players.p1.words.length > 0
        ? room.players.p1.words
        : room.words;
    const p2Words = room.players.p2?.words ?? [];
    const merged = mergeWordLists(
      p1Words,
      p2Words,
      p1Words.length || WORDS_PER_BATTLE
    );
    tx.update(ref, {
      status: "playing",
      winner: null,
      wordIndex: 0,
      turnStartedAt: serverTimestamp(),
      words: merged,
      rematchReady: { p1: false, p2: false },
      "players.p1.hits": [],
      "players.p1.streak": 0,
      "players.p1.lastAnswer": null,
      "players.p2.hits": [],
      "players.p2.streak": 0,
      "players.p2.lastAnswer": null,
    });
  });
}
