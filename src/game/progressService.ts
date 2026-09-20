import {
  doc,
  getDoc,
  increment,
  runTransaction,
  serverTimestamp,
  type DocumentReference,
  type Timestamp,
} from "firebase/firestore";
import { ensureAnonAuth, getFirebase } from "../lib/firebase";
import { PROGRESS_COLLECTION } from "../lib/gameConfig";
import type { ResultOutcome } from "./types";

type ProgressDoc = {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  bestStreak: number;
  lastPlayedAt: Timestamp | null;
};

export type Progress = {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  bestStreak: number;
  lastPlayedAtMs: number | null;
};

function progressRef(uid: string) {
  const { fs } = getFirebase();
  return doc(fs, PROGRESS_COLLECTION, uid) as DocumentReference<ProgressDoc>;
}

export async function fetchProgress(uid: string): Promise<Progress | null> {
  const snap = await getDoc(progressRef(uid));
  const data = snap.data();
  if (!data) return null;
  const ts = data.lastPlayedAt as unknown as { toMillis?: () => number } | null;
  return {
    games: data.games ?? 0,
    wins: data.wins ?? 0,
    losses: data.losses ?? 0,
    draws: data.draws ?? 0,
    bestStreak: data.bestStreak ?? 0,
    lastPlayedAtMs: typeof ts?.toMillis === "function" ? ts.toMillis() : null,
  };
}

export async function recordResult(
  outcome: ResultOutcome,
  streak: number
): Promise<void> {
  const uid = await ensureAnonAuth();
  const ref = progressRef(uid);
  await runTransaction(ref.firestore, async (tx) => {
    const snap = await tx.get(ref);
    const bestStreak = Math.max(snap.data()?.bestStreak ?? 0, streak);
    if (snap.exists()) {
      tx.update(ref, {
        games: increment(1),
        wins: increment(outcome === "win" ? 1 : 0),
        losses: increment(outcome === "lose" ? 1 : 0),
        draws: increment(outcome === "draw" ? 1 : 0),
        bestStreak,
        lastPlayedAt: serverTimestamp(),
      });
    } else {
      tx.set(ref, {
        games: 1,
        wins: outcome === "win" ? 1 : 0,
        losses: outcome === "lose" ? 1 : 0,
        draws: outcome === "draw" ? 1 : 0,
        bestStreak,
        lastPlayedAt: serverTimestamp(),
      });
    }
  });
}
