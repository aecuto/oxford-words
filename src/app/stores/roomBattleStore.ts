"use client";

import { create } from "zustand";
import { computeHit, clampElapsed, deriveHp } from "../../game/damage";
import {
  advanceWord,
  endGame,
  getRoom,
  joinRoom,
  startGame,
  subscribeRoom,
  submitAnswer,
} from "../../game/roomService";
import type {
  AnswerState,
  ClientRoom,
  Hit,
  LastAnswer,
  Popup,
  ResultOutcome,
  RoomStatus,
  SlotKey,
} from "../../game/types";
import {
  DEFAULT_PLAYER_NAMES,
  POPUP_LIFETIME_MS,
  TURN_GRACE_MS,
  TURN_MS,
  WORDS_PER_BATTLE,
  WRONG_ANSWER_HIT,
} from "../../lib/gameConfig";
import { describeAuthError, ensureAnonAuth } from "../../lib/firebase";
import {
  loadWordStats,
  saveWordResults,
  type WordResult,
} from "../../game/wordProgress";
import { loadWordPool, pickBattleWords, mergeWordLists } from "../../game/wordPool";
import { recordResult } from "../../game/progressService";
import {
  saveBattleSummary,
  type BattleWordDetail,
} from "../../game/battleSummary";

export type BattleOutcome = ResultOutcome | null;

export type BattleView = {
  myName: string;
  oppName: string;
  myHp: number;
  oppHp: number;
  myStreak: number;
  oppStreak: number;
  word: ClientRoom["words"][number] | null;
  wordNumber: number;
  wordTotal: number;
  wordResults?: (boolean | null)[];
  /** Per-word instant grade for the pips; solo only — PvP has no response times. */
  wordMarks?: (boolean | null)[];
  selected: string | null;
  answerState: AnswerState;
  waitingOpp: boolean;
  /** Solo only: the bot is mid-thought on the current word. */
  oppThinking?: boolean;
  turnStartedAt: number | null;
  popups: Popup[];
  outcome: BattleOutcome;
};

// PvP battle state. Unlike solo, the room doc on Firestore is the source of
// truth — this store mirrors the latest snapshot and owns every projection
// (view, phase, isHost) plus its own damage popups, the snapshot guards and
// the summary/SRS buffers. The imperative resources (subscription handle,
// in-flight op dedupe, settle timer) are module state. Everything per-battle
// is reset by connect() when a room page mounts, matching the per-mount
// lifetime the old refs had. Lives in src/app/ — src/game/ stays
// framework-free.
type RoomWordDetail = {
  wordIndex: number;
  word: string;
  type?: string;
  correct: boolean;
};

type RoomPhase =
  | "error"
  | "join"
  | "loading"
  | "rematch"
  | RoomStatus;

type RoomBattleState = {
  code: string | null;
  room: ClientRoom | null;
  uid: string | null;
  error: string | null;
  needsJoin: boolean;
  joining: boolean;
  // Hit-count diff per side between snapshots: only the delta spawns a
  // damage popup, so reconnects don't replay the whole battle.
  hpLens: { me: number; opp: number } | null;
  // Submit-once guard for the current word (clicks, deadline, retries).
  submittedWord: number;
  // Only record progress for battles actually seen live, never for a
  // snapshot replay of a finished room.
  liveSeen: boolean;
  recordedRoom: string | null;
  // Summary/SRS buffers, drained by the outcome action.
  results: WordResult[];
  bestStreak: number;
  wordDetails: RoomWordDetail[];
  // React-facing projections, recomputed by commit() after every mutation.
  view: BattleView | null;
  phase: RoomPhase;
  isHost: boolean;
  popups: Popup[];
};

const freshRoomBattle = (code: string | null): RoomBattleState => ({
  code,
  room: null,
  uid: null,
  error: null,
  needsJoin: false,
  joining: false,
  hpLens: null,
  submittedWord: -1,
  liveSeen: false,
  recordedRoom: null,
  results: [],
  bestStreak: 0,
  wordDetails: [],
  view: null,
  phase: "loading",
  isHost: false,
  popups: [],
});

// Imperative resources — never rendered, never mirrored in React.
let unsub: (() => void) | null = null;
const acting = new Set<string>();
let settleTimer: number | null = null;

function slotOf(r: ClientRoom, uid: string): SlotKey | null {
  return r.players.p1?.uid === uid
    ? "p1"
    : r.players.p2?.uid === uid
      ? "p2"
      : null;
}

function roomOutcome(room: ClientRoom, uid: string): BattleOutcome {
  if (room.status !== "ended") return null;
  const key = slotOf(room, uid);
  if (!key) return null;
  return room.winner === "draw" ? "draw" : room.winner === key ? "win" : "lose";
}

function penaltyHit(wordIndex: number): Hit {
  return {
    wordIndex,
    damage: WRONG_ANSWER_HIT,
    crit: false,
    at: Date.now(),
  };
}

function buildRoomView(
  room: ClientRoom,
  slotKey: SlotKey,
  popups: Popup[]
): BattleView {
  const oppKey: SlotKey = slotKey === "p1" ? "p2" : "p1";
  const my = room.players[slotKey];
  const opp = room.players[oppKey];
  if (!my) {
    // Unreachable: a snapshot is only accepted once the player is seated.
    return {
      myName: "",
      oppName: "",
      myHp: 0,
      oppHp: 0,
      myStreak: 0,
      oppStreak: 0,
      word: null,
      wordNumber: 1,
      wordTotal: room.words.length,
      selected: null,
      answerState: "idle",
      waitingOpp: false,
      turnStartedAt: null,
      popups,
      outcome: null,
    };
  }

  const myHp = deriveHp(opp?.hits ?? []);
  const oppHp = deriveHp(my.hits);
  const current = room.words[room.wordIndex] ?? null;
  const answeredCurrent = my.lastAnswer?.wordIndex === room.wordIndex;
  const answerState: BattleView["answerState"] = !answeredCurrent
    ? "idle"
    : my.lastAnswer!.correct
      ? "correct"
      : my.lastAnswer!.answer === ""
        ? "timeout"
        : "wrong";
  const oppAnswered = opp?.lastAnswer?.wordIndex === room.wordIndex;

  const outcome: BattleOutcome =
    room.status === "ended"
      ? room.winner === "draw"
        ? "draw"
        : room.winner === slotKey
          ? "win"
          : "lose"
      : null;

  return {
    myName: my.name,
    oppName: opp?.name ?? "Waiting...",
    myHp,
    oppHp,
    myStreak: my.streak,
    oppStreak: opp?.streak ?? 0,
    word: current,
    wordNumber: room.wordIndex + 1,
    wordTotal: room.words.length,
    wordResults: room.words.map((_, i) => {
      if (my.hits.some((h) => h.wordIndex === i)) return true;
      if (opp?.hits.some((h) => h.wordIndex === i)) return false;
      if (i === room.wordIndex) {
        return answeredCurrent ? my.lastAnswer!.correct : null;
      }
      return null;
    }),
    selected: answeredCurrent ? my.lastAnswer!.answer : null,
    answerState,
    waitingOpp: answeredCurrent && !oppAnswered && room.status === "playing",
    turnStartedAt: room.status === "playing" ? room.turnStartedAt ?? null : null,
    popups,
    outcome,
  };
}

const stopWatching = () => {
  unsub?.();
  unsub = null;
};

// Only the page-facing surface: connect/disconnect lifecycle, the join
// flow, host settle paths and the answer entry points. Everything else
// (snapshot diffing, op dedupe, submit guards, summary buffers) stays
// store-internal and never reaches React.
type RoomBattleActions = {
  connect: (code: string) => Promise<void>;
  disconnect: () => void;
  join: (joinName: string) => Promise<void>;
  maybeAutoStart: () => void;
  settleTurn: () => void;
  deadlineTick: () => void;
  submitPlayer: (answer: string | null) => Promise<void>;
  recordOutcome: () => void;
};

export const useRoomBattleStore = create<
  RoomBattleState & RoomBattleActions
>()((set, get) => {
  // Every mutation goes through commit: the projections (view, phase,
  // isHost) are recomputed from the merged state, so they can never drift.
  const commit = (partial: Partial<RoomBattleState>) => {
    const next = { ...get(), ...partial };
    const slotKey =
      next.room && next.uid ? slotOf(next.room, next.uid) : null;
    const view =
      next.room && slotKey
        ? buildRoomView(next.room, slotKey, next.popups)
        : null;
    const isHost =
      next.room != null && next.uid != null && next.room.hostUid === next.uid;
    const rematchWaiting =
      next.room?.status === "ended" &&
      slotKey != null &&
      next.room.rematchReady?.[slotKey] === true;
    const phase: RoomBattleState["phase"] =
      next.error
        ? "error"
        : next.needsJoin
          ? "join"
          : !view
            ? "loading"
            : rematchWaiting
              ? "rematch"
              : next.room?.status ?? "loading";
    set({ ...partial, view, isHost, phase });
  };

  const spawnPopup = (side: Popup["side"], damage: number, crit: boolean) => {
    const popup: Popup = { id: Date.now() + Math.random(), side, damage, crit };
    commit({ popups: [...get().popups.slice(-4), popup] });
    window.setTimeout(() => {
      commit({ popups: get().popups.filter((p) => p.id !== popup.id) });
    }, POPUP_LIFETIME_MS);
  };

  /** Dedupes concurrent network ops by key (host settle, timeout, ...). */
  const act = (key: string, fn: () => Promise<unknown>) => {
    if (acting.has(key)) return;
    acting.add(key);
    fn()
      .catch((e) => console.error(`battle:${key}`, e))
      .finally(() => {
        acting.delete(key);
      });
  };

  const applySnapshot = (myUid: string, r: ClientRoom | null) => {
    const state = get();
    // A snapshot from a previous subscription can outlive its cleanup —
    // only accept snapshots for the bound room.
    if (!state.code || (r != null && r.code !== state.code)) return;
    if (!r) {
      commit({ room: null, hpLens: null });
      return;
    }
    const key = slotOf(r, myUid);
    if (!key) {
      commit({ room: r, hpLens: null });
      return;
    }

    // Diff hit counts against the previous snapshot; only new hits spawn
    // popups, and only when they landed on the current word.
    const oppKey: SlotKey = key === "p1" ? "p2" : "p1";
    const myHits = r.players[key]?.hits ?? [];
    const oppHits = r.players[oppKey]?.hits ?? [];
    const lens = { me: oppHits.length, opp: myHits.length };
    const prev = state.hpLens;
    if (prev) {
      if (lens.opp > prev.opp) {
        const hit = myHits[lens.opp - 1];
        if (hit && hit.wordIndex === r.wordIndex) {
          spawnPopup("opp", hit.damage, hit.crit);
        }
      }
      if (lens.me > prev.me) {
        const hit = oppHits[lens.me - 1];
        if (hit && hit.wordIndex === r.wordIndex) {
          spawnPopup("me", hit.damage, hit.crit);
        }
      }
    }

    commit({
      room: r,
      hpLens: lens,
      liveSeen: r.status === "playing" ? true : state.liveSeen,
    });
  };

  const watch = (myUid: string) => {
    stopWatching();
    const code = get().code;
    if (!code) return;
    unsub = subscribeRoom(code, (r) => applySnapshot(myUid, r));
  };

  /** Returns false when this word was already submitted. */
  const claimSubmit = (wordIndex: number): boolean => {
    if (get().submittedWord === wordIndex) return false;
    set({ submittedWord: wordIndex });
    return true;
  };

  const releaseSubmit = () => set({ submittedWord: -1 });

  const noteBestStreak = (streak: number) => {
    if (streak > get().bestStreak) set({ bestStreak: streak });
  };

  const pushAnswered = (result: WordResult, detail: RoomWordDetail) =>
    set((state) => ({
      results: [...state.results, result],
      wordDetails: [...state.wordDetails, detail],
    }));

  const submitPlayer = async (answer: string | null) => {
    const st = get();
    const r = st.room;
    const myUid = st.uid;
    if (!r || r.status !== "playing" || !myUid) return;
    const key = slotOf(r, myUid);
    if (!key) return;
    const my = r.players[key];
    if (!my || my.lastAnswer?.wordIndex === r.wordIndex) return;
    if (!claimSubmit(r.wordIndex)) return;

    const current = r.words[r.wordIndex];
    if (!current) return;

    const elapsed = clampElapsed(
      r.turnStartedAt == null ? TURN_MS : Date.now() - r.turnStartedAt
    );
    const timeout = answer == null;
    const correct = !timeout && answer === current.correctAnswer;
    const streak = correct ? my.streak + 1 : 0;
    noteBestStreak(streak);

    let hit: Hit | null = null;
    let oppHit: Hit | null = null;
    if (correct) {
      const res = computeHit(elapsed, my.streak);
      if (res) {
        hit = {
          wordIndex: r.wordIndex,
          damage: res.damage,
          crit: res.crit,
          at: Date.now(),
        };
      }
    } else {
      oppHit = penaltyHit(r.wordIndex);
    }

    const lastAnswer: LastAnswer = {
      wordIndex: r.wordIndex,
      answer: answer ?? "",
      correct,
      at: Date.now(),
    };
    // Response time + timeout flag drive the 2-option SRS grade in
    // wordProgress: instant (<2s) masters the word, everything else is a
    // retry that keeps it in Pool B for active review.
    pushAnswered(
      {
        word: current.word,
        correct,
        ms: elapsed,
        timeout: answer == null,
      },
      {
        wordIndex: r.wordIndex,
        word: current.word,
        type: current.type,
        correct,
      }
    );

    await submitAnswer(r.code, key, lastAnswer, hit, streak, oppHit).catch(
      (e) => {
        console.error("battle:submit", e);
        // Let the click or the deadline retry this word.
        releaseSubmit();
      }
    );
  };

  return {
    ...freshRoomBattle(null),

    connect: async (code) => {
      set(freshRoomBattle(code));
      try {
        const myUid = await ensureAnonAuth();
        // Currency checks replace the old `alive` flag: a slow auth that
        // resolves after a navigation must not touch the new room's state.
        if (get().code !== code) return;
        commit({ uid: myUid });

        const existing = await getRoom(code);
        if (get().code !== code) return;
        if (!existing) {
          commit({ error: "Room not found or already closed. Join from the lobby list or ask for a new invite link." });
          return;
        }
        if (slotOf(existing, myUid)) {
          watch(myUid);
          return;
        }
        if (existing.players.p2 !== null || existing.status !== "waiting") {
          commit({ error: "This room is full." });
          return;
        }
        commit({ needsJoin: true });
      } catch (e) {
        console.error(e);
        if (get().code === code) {
          commit({ error: describeAuthError(e) });
        }
      }
    },

    disconnect: () => {
      stopWatching();
      if (settleTimer != null) {
        window.clearTimeout(settleTimer);
        settleTimer = null;
      }
    },

    join: async (joinName) => {
      const st = get();
      const code = st.code;
      const myUid = st.uid;
      if (!code || !myUid || st.joining) return;
      commit({ joining: true });
      try {
        const pool = await loadWordPool();
        // Words published on the room doc (the host's pick for the pending
        // battle, or the last battle's set on a rematch) must not reappear
        // in my half — I only know my own stats, so exclusion is explicit.
        const shown = await getRoom(code);
        const excluded = [
          ...(shown?.words ?? []),
          ...(shown?.players.p1?.words ?? []),
        ].map((w) => w.word);
        const myWords = pickBattleWords(
          pool,
          WORDS_PER_BATTLE,
          loadWordStats(),
          excluded
        );
        await joinRoom(code, myUid, joinName.trim() || DEFAULT_PLAYER_NAMES.p2, myWords);
        watch(myUid);
        commit({ needsJoin: false });
      } catch (e) {
        console.error("battle:join", e);
        commit({ error: describeAuthError(e) });
      } finally {
        commit({ joining: false });
      }
    },

    // First game only: rematches start from the rematchRoom transaction once
    // both players press Play again, never from this auto-start.
    maybeAutoStart: () => {
      const st = get();
      const r = st.room;
      if (!r || !st.uid || st.uid !== r.hostUid) return;
      if (r.rematchReady?.p1 || r.rematchReady?.p2) return;
      if (r.status === "waiting" && r.players.p2 != null) {
        act("start", async () => {
          const merged = mergeWordLists(
            r.words,
            r.players.p2?.words ?? [],
            r.words.length || WORDS_PER_BATTLE
          );
          await startGame(r.code, merged);
        });
      }
    },

    settleTurn: () => {
      if (settleTimer != null) {
        window.clearTimeout(settleTimer);
        settleTimer = null;
      }
      const st = get();
      const r = st.room;
      if (!r || !st.uid || st.uid !== r.hostUid) return;
      if (r.status !== "playing" || r.turnStartedAt == null) return;

      const current = r.wordIndex;
      const answered = (k: SlotKey) =>
        r.players[k]?.lastAnswer?.wordIndex === current;
      const bothAnswered =
        answered("p1") && r.players.p2 != null && answered("p2");
      const expired = Date.now() > r.turnStartedAt + TURN_MS + TURN_GRACE_MS;
      if (!bothAnswered && !expired) return;

      const hp1 = deriveHp(r.players.p2?.hits ?? []);
      const hp2 = deriveHp(r.players.p1?.hits ?? []);
      const ko = hp1 <= 0 || hp2 <= 0;
      const lastWord = current + 1 >= r.words.length;

      const settleMs = bothAnswered && !expired ? 900 : 0;
      settleTimer = window.setTimeout(() => {
        settleTimer = null;
        if (ko || lastWord) {
          const winner =
            hp1 <= 0 && hp2 <= 0
              ? "draw"
              : hp1 <= 0
                ? "p2"
                : hp2 <= 0
                  ? "p1"
                  : byHp(hp1, hp2);
          act(`end-${current}`, () => endGame(r.code, winner));
        } else {
          act(`adv-${current}`, () => advanceWord(r.code, current + 1));
        }
      }, settleMs);
    },

    deadlineTick: () => {
      const st = get();
      const cur = st.room;
      if (!cur || cur.status !== "playing" || cur.turnStartedAt == null) return;
      if (Date.now() < cur.turnStartedAt + TURN_MS) return;
      const key = st.uid ? slotOf(cur, st.uid) : null;
      if (!key) return;
      const my = cur.players[key];
      if (!my || my.lastAnswer?.wordIndex === cur.wordIndex) return;
      if (!claimSubmit(cur.wordIndex)) return;
      const timedOutWord = cur.words[cur.wordIndex];
      if (timedOutWord) {
        pushAnswered(
          {
            word: timedOutWord.word,
            correct: false,
            ms: TURN_MS,
            timeout: true,
          },
          {
            wordIndex: cur.wordIndex,
            word: timedOutWord.word,
            type: timedOutWord.type,
            correct: false,
          }
        );
      }
      act(`timeout-${cur.wordIndex}`, () =>
        submitAnswer(
          cur.code,
          key,
          {
            wordIndex: cur.wordIndex,
            answer: "",
            correct: false,
            at: Date.now(),
          },
          null,
          0,
          penaltyHit(cur.wordIndex)
        )
      );
    },

    submitPlayer,

    recordOutcome: () => {
      const st = get();
      const room = st.room;
      if (!room || !st.uid) return;
      const outcome = roomOutcome(room, st.uid);
      if (!outcome) return;
      // Only record battles seen live, never a replay of a finished room,
      // and only once per room.
      if (!st.liveSeen) return;
      if (st.recordedRoom === room.code) return;
      set({ recordedRoom: room.code });
      const slotKey = slotOf(room, st.uid);
      if (!slotKey) return;
      const oppKey: SlotKey = slotKey === "p1" ? "p2" : "p1";
      const myHits = room.players[slotKey]?.hits ?? [];
      const oppHits = room.players[oppKey]?.hits ?? [];
      const words: BattleWordDetail[] = st.wordDetails.map((d) => ({
        word: d.word,
        type: d.type,
        pronounceURL: room.words.find((w) => w.word === d.word)?.pronounceURL,
        answer: room.words.find((w) => w.word === d.word)?.correctAnswer,
        correct: d.correct,
        dealt: myHits
          .filter((h) => h.wordIndex === d.wordIndex)
          .reduce((sum, h) => sum + h.damage, 0),
        taken: oppHits
          .filter((h) => h.wordIndex === d.wordIndex)
          .reduce((sum, h) => sum + h.damage, 0),
      }));
      saveBattleSummary({
        outcome,
        mode: "room",
        opponent: room.players[oppKey]?.name ?? undefined,
        roomCode: room.code,
        total: room.words.length,
        answered: words.length,
        correct: words.filter((w) => w.correct).length,
        bestStreak: st.bestStreak,
        damageDealt: words.reduce((sum, w) => sum + w.dealt, 0),
        damageTaken: words.reduce((sum, w) => sum + w.taken, 0),
        words,
      });
      recordResult(outcome, room.players[slotKey]?.streak ?? 0).catch((e) =>
        console.error("progress:record", e)
      );
      const drained = get().results;
      set({ results: [] });
      if (drained.length) {
        saveWordResults(drained);
      }
    },
  };
});

function byHp(hp1: number, hp2: number): "p1" | "p2" | "draw" {
  if (hp1 === hp2) return "draw";
  return hp1 > hp2 ? "p1" : "p2";
}
