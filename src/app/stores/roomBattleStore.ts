"use client";

import { create } from "zustand";
import {
  advanceWord,
  endGame,
  getRoom,
  joinRoom,
  placeMark,
  startGame,
  submitAnswer,
  subscribeRoom,
} from "../../game/roomService";
import {
  checkWinner,
  createBoard,
  markFor,
  nextToFade,
} from "../../game/tictactoe";
import type {
  AnswerState,
  Cell,
  ClientRoom,
  LastAnswer,
  ResultOutcome,
  RoomStatus,
  SlotKey,
  Winner,
} from "../../game/types";
import {
  DEFAULT_PLAYER_NAMES,
  PLACEMENT_GRACE_MS,
  TURN_MS,
  WORDS_PER_BATTLE,
} from "../../lib/gameConfig";
import { describeAuthError, ensureAnonAuth } from "../../lib/firebase";
import {
  loadWordStats,
  saveWordResults,
  type WordResult,
} from "../../game/wordProgress";
import { loadWordPool, pickBattleWords, roomWordSet } from "../../game/wordPool";
import { recordResult } from "../../game/progressService";
import {
  saveBattleSummary,
  type BattleWordDetail,
} from "../../game/battleSummary";

export type BattleOutcome = ResultOutcome | null;

export type BattleView = {
  myName: string;
  oppName: string;
  myMark: Cell;
  oppMark: Cell;
  board: Cell[];
  moves: ClientRoom["moves"];
  // I've earned a placement on the current word and haven't tapped a cell.
  pendingPlacement: boolean;
  // Cells that fade on the next placement of that side (the "about to
  // vanish" highlight), null while a side holds fewer marks.
  myNextFade: number | null;
  oppNextFade: number | null;
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
  outcome: BattleOutcome;
};

// PvP battle state. Unlike solo, the room doc on Firestore is the source of
// truth — this store mirrors the latest snapshot and owns every projection
// (view, phase, isHost) plus the snapshot guards and the summary/SRS
// buffers. The imperative resources (subscription handle, in-flight op
// dedupe, settle timer) are module state. Everything per-battle is reset by
// connect() when a room page mounts, matching the per-mount lifetime the
// old refs had. Lives in src/app/ — src/game/ stays framework-free.
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
  // Submit-once guard for the current word (clicks, deadline, retries).
  submittedWord: number;
  // Placement-once guard for the current word (double taps before the
  // placement transaction's snapshot lands); reset when the placement
  // didn't land so an occupied cell can be re-tapped.
  placedWord: number;
  // Only record progress for battles actually seen live, never for a
  // snapshot replay of a finished room.
  liveSeen: boolean;
  recordedRoom: string | null;
  // Summary/SRS buffers, drained by the outcome action.
  results: WordResult[];
  wordDetails: RoomWordDetail[];
  // React-facing projections, recomputed by commit() after every mutation.
  view: BattleView | null;
  phase: RoomPhase;
  isHost: boolean;
};

const freshRoomBattle = (code: string | null): RoomBattleState => ({
  code,
  room: null,
  uid: null,
  error: null,
  needsJoin: false,
  joining: false,
  submittedWord: -1,
  placedWord: -1,
  liveSeen: false,
  recordedRoom: null,
  results: [],
  wordDetails: [],
  view: null,
  phase: "loading",
  isHost: false,
});

// Imperative resources — never rendered, never mirrored in React.
let unsub: (() => void) | null = null;
const acting = new Set<string>();
let settleTimer: number | null = null;
let settleWord: number | null = null;

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

function buildRoomView(
  room: ClientRoom,
  slotKey: SlotKey
): BattleView {
  const oppKey: SlotKey = slotKey === "p1" ? "p2" : "p1";
  const my = room.players[slotKey];
  const opp = room.players[oppKey];
  const board = room.board ?? createBoard();
  const moves = room.moves ?? [];
  if (!my) {
    // Unreachable: a snapshot is only accepted once the player is seated.
    return {
      myName: "",
      oppName: "",
      myMark: "X",
      oppMark: "O",
      board,
      moves,
      pendingPlacement: false,
      myNextFade: null,
      oppNextFade: null,
      word: null,
      wordNumber: 1,
      wordTotal: room.words.length,
      selected: null,
      answerState: "idle",
      waitingOpp: false,
      turnStartedAt: null,
      outcome: null,
    };
  }

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

  // A correct answer keeps the board open for me until my move for this
  // word shows up on the doc — placements and answers resolve on their own
  // clocks (the placement transaction can lag the answer write).
  const pendingPlacement =
    room.status === "playing" &&
    answeredCurrent &&
    my.lastAnswer!.correct &&
    !moves.some((m) => m.slot === slotKey && m.wordIndex === room.wordIndex);

  return {
    myName: my.name,
    oppName: opp?.name ?? "Waiting...",
    myMark: markFor(slotKey),
    oppMark: markFor(oppKey),
    board,
    moves,
    pendingPlacement: pendingPlacement && outcome === null,
    myNextFade: nextToFade(board, moves, slotKey),
    oppNextFade: nextToFade(board, moves, oppKey),
    word: current,
    wordNumber: room.wordIndex + 1,
    wordTotal: room.words.length,
    wordResults: room.words.map((_, i) => {
      if (my.correctIdx?.includes(i)) return true;
      if (my.wrongIdx?.includes(i)) return false;
      if (i === room.wordIndex) {
        return answeredCurrent ? my.lastAnswer!.correct : null;
      }
      return null;
    }),
    selected: answeredCurrent ? my.lastAnswer!.answer : null,
    answerState,
    waitingOpp: answeredCurrent && !oppAnswered && room.status === "playing",
    turnStartedAt: room.status === "playing" ? room.turnStartedAt ?? null : null,
    outcome,
  };
}

const stopWatching = () => {
  unsub?.();
  unsub = null;
};

// Only the page-facing surface: connect/disconnect lifecycle, the join
// flow, host settle paths and the answer/placement entry points. Everything
// else (snapshot guards, op dedupe, submit guards, summary buffers) stays
// store-internal and never reaches React.
type RoomBattleActions = {
  connect: (code: string) => Promise<void>;
  disconnect: () => void;
  join: (joinName: string) => Promise<void>;
  maybeAutoStart: () => void;
  settleTurn: () => void;
  deadlineTick: () => void;
  submitPlayer: (answer: string | null) => Promise<void>;
  placeMyMark: (cell: number) => Promise<void>;
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
        ? buildRoomView(next.room, slotKey)
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
      commit({ room: null });
      return;
    }
    const key = slotOf(r, myUid);
    if (!key) {
      commit({ room: r });
      return;
    }
    commit({
      room: r,
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

    const elapsed = Math.min(
      Math.max(
        r.turnStartedAt == null ? TURN_MS : Date.now() - r.turnStartedAt,
        0
      ),
      TURN_MS
    );
    const timeout = answer == null;
    const correct = !timeout && answer === current.correctAnswer;

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

    await submitAnswer(r.code, key, lastAnswer, correct).catch((e) => {
      console.error("battle:submit", e);
      // Let the click or the deadline retry this word.
      releaseSubmit();
    });
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
        settleWord = null;
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
          const merged = roomWordSet(r.words, r.players.p2?.words ?? []);
          await startGame(r.code, merged);
        });
      }
    },

    // Host-only: ends the game on a finished board, otherwise advances once
    // the word is fully resolved — both answers in, every earned placement
    // on the board (a player who ran out the clock without placing
    // forfeits the mark). Re-runs on every snapshot; the scheduled settle
    // is keyed by word so live snapshots can't reset it forever.
    settleTurn: () => {
      const st = get();
      const r = st.room;
      if (!r || !st.uid || st.uid !== r.hostUid) return;
      if (r.status !== "playing" || r.turnStartedAt == null) return;

      const current = r.wordIndex;
      const board = r.board ?? createBoard();
      const moves = r.moves ?? [];

      // A finished board outranks everything: end immediately.
      const winnerMark = checkWinner(board);
      if (winnerMark) {
        if (settleTimer != null) {
          window.clearTimeout(settleTimer);
          settleTimer = null;
          settleWord = null;
        }
        const winner: Winner = winnerMark === "X" ? "p1" : "p2";
        act(`end-${current}`, () => endGame(r.code, winner));
        return;
      }

      const answered = (k: SlotKey) =>
        r.players[k]?.lastAnswer?.wordIndex === current;
      const bothAnswered =
        answered("p1") && r.players.p2 != null && answered("p2");
      if (!bothAnswered) return;

      const placementMissing = (k: SlotKey) => {
        const p = r.players[k];
        if (!p?.lastAnswer || p.lastAnswer.wordIndex !== current) return false;
        if (!p.lastAnswer.correct) return false;
        return !moves.some((m) => m.slot === k && m.wordIndex === current);
      };
      const forfeit =
        Date.now() > r.turnStartedAt + TURN_MS + PLACEMENT_GRACE_MS;
      if ((placementMissing("p1") || placementMissing("p2")) && !forfeit) {
        return;
      }

      const lastWord = current + 1 >= r.words.length;
      if (settleTimer != null && settleWord === current) return;
      if (settleTimer != null) {
        window.clearTimeout(settleTimer);
        settleTimer = null;
      }
      settleWord = current;
      settleTimer = window.setTimeout(() => {
        settleTimer = null;
        settleWord = null;
        if (lastWord) {
          // The words ran dry before a 3-in-a-row: most correct answers
          // wins, tracked doc-side as each answer lands.
          const c1 = r.players.p1?.correctIdx?.length ?? 0;
          const c2 = r.players.p2?.correctIdx?.length ?? 0;
          const winner: Winner = c1 === c2 ? "draw" : c1 > c2 ? "p1" : "p2";
          act(`end-${current}`, () => endGame(r.code, winner));
        } else {
          act(`adv-${current}`, () => advanceWord(r.code, current + 1));
        }
      }, 900);
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
          false
        )
      );
    },

    submitPlayer,

    placeMyMark: async (cell) => {
      const st = get();
      const r = st.room;
      const myUid = st.uid;
      if (!r || r.status !== "playing" || !myUid) return;
      const key = slotOf(r, myUid);
      if (!key) return;
      if (!st.view?.pendingPlacement) return;
      const board = r.board ?? createBoard();
      if (cell < 0 || cell >= board.length || board[cell] !== "") return;
      // Block double taps before the transaction's snapshot lands; if the
      // placement didn't land (cell taken by a simultaneous opponent
      // placement), re-open so the refreshed board can be re-tapped.
      if (st.placedWord === r.wordIndex) return;
      set({ placedWord: r.wordIndex });
      let landed = false;
      try {
        landed = await placeMark(r.code, key, cell, r.wordIndex);
      } catch (e) {
        console.error("battle:place", e);
      }
      if (!landed) set({ placedWord: -1 });
    },

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
      const words: BattleWordDetail[] = st.wordDetails.map((d) => ({
        word: d.word,
        type: d.type,
        pronounceURL: room.words.find((w) => w.word === d.word)?.pronounceURL,
        answer: room.words.find((w) => w.word === d.word)?.correctAnswer,
        correct: d.correct,
      }));
      saveBattleSummary({
        outcome,
        mode: "room",
        opponent: room.players[oppKey]?.name ?? undefined,
        roomCode: room.code,
        total: room.words.length,
        answered: words.length,
        correct: words.filter((w) => w.correct).length,
        words,
      });
      recordResult(outcome).catch((e) =>
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
