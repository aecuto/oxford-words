"use client";

import { create } from "zustand";
import {
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
  // I've earned a placement (latest answer correct) and haven't tapped a
  // cell for it — the board is mine to place on, across word boundaries.
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
  /** PvP only: my latest answer missed — reveal the right answer inline. */
  feedback?: { answer: string } | null;
  /** Solo only: the bot is mid-thought on the current word. */
  oppThinking?: boolean;
  outcome: BattleOutcome;
};

// PvP battle state. The room doc on Firestore is the source of truth, and
// the game is SELF-PACED: each player's slot carries its own wordIndex and
// clock, every answer deals that player their next word in the same write,
// and nobody ever waits for the opponent between words. Faster correct
// answers simply mean more words — and more board placements. This store
// mirrors the latest snapshot and owns every projection (view, phase,
// isHost) plus the summary/SRS buffers; imperative resources (subscription
// handle, in-flight op dedupe) are module state. Everything per-battle is
// reset by connect() when a room page mounts. Lives in src/app/ —
// src/game/ stays framework-free.
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
  // Submit-once guard for my current word (clicks, deadline, retries).
  submittedWord: number;
  // Placement-once guard for my pending placement (double taps before the
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

type ClientSlot = NonNullable<ClientRoom["players"][SlotKey]>;

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
      feedback: null,
      outcome: null,
    };
  }

  const outcome: BattleOutcome =
    room.status === "ended"
      ? room.winner === "draw"
        ? "draw"
        : room.winner === slotKey
          ? "win"
          : "lose"
      : null;

  // My current word is whatever my own pointer says — the opponent's
  // progress never gates it. (?? 0 reads rooms created before the
  // self-paced schema; they can only be in ended/closed states anyway.)
  const myIdx = my.wordIndex ?? 0;
  const myWord = room.words[myIdx] ?? null;

  // A correct latest answer keeps the board open for me until my placement
  // for exactly that word shows up on the doc.
  const pendingPlacement =
    room.status === "playing" &&
    my.lastAnswer?.correct === true &&
    !moves.some((m) => m.slot === slotKey && m.wordIndex === my.lastAnswer!.wordIndex);

  // My latest answer missed: keep the right answer on screen until my next
  // word resolves (a correct answer replaces it with the placement prompt).
  const missed =
    room.status === "playing" &&
    my.lastAnswer != null &&
    my.lastAnswer.wordIndex === myIdx - 1 &&
    !my.lastAnswer.correct;
  const feedback = missed
    ? { answer: room.words[my.lastAnswer!.wordIndex]?.correctAnswer ?? "" }
    : null;

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
    word: myWord,
    wordNumber: Math.min(myIdx + 1, room.words.length),
    wordTotal: room.words.length,
    wordResults: room.words.map((_, i) => {
      if (my.correctIdx?.includes(i)) return true;
      if (my.wrongIdx?.includes(i)) return false;
      return null;
    }),
    selected: null,
    answerState: "idle",
    feedback,
    outcome,
  };
}

const stopWatching = () => {
  unsub?.();
  unsub = null;
};

// Only the page-facing surface: connect/disconnect lifecycle, the join
// flow, the referee and the answer/placement entry points. Everything else
// (snapshot guards, op dedupe, submit guards, summary buffers) stays
// store-internal and never reaches React.
type RoomBattleActions = {
  connect: (code: string) => Promise<void>;
  disconnect: () => void;
  join: (joinName: string) => Promise<void>;
  maybeAutoStart: () => void;
  referee: () => void;
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

  /** Dedupes concurrent network ops by key (referee, timeout, ...). */
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
    const my: ClientSlot | null = r.players[key];
    if (!my) return;
    // Already answered my current word — the write itself deals the next.
    const myIdx = my.wordIndex ?? 0;
    if (my.lastAnswer?.wordIndex === myIdx) return;
    if (!claimSubmit(myIdx)) return;

    const current = r.words[myIdx];
    if (!current) return;

    // Response time since the word was dealt to me drives the 2-option SRS
    // grade in wordProgress: instant (<2s) masters the word, everything
    // else — slow, guess, wrong — is a retry that keeps it in Pool B.
    const elapsed = my.turnStartedAt == null ? 0 : Date.now() - my.turnStartedAt;
    const correct = answer === current.correctAnswer;

    const lastAnswer: LastAnswer = {
      wordIndex: myIdx,
      answer: answer ?? "",
      correct,
      at: Date.now(),
    };
    pushAnswered(
      {
        word: current.word,
        correct,
        ms: elapsed,
        timeout: answer == null,
      },
      {
        wordIndex: myIdx,
        word: current.word,
        type: current.type,
        correct,
      }
    );

    // One atomic write records the answer and deals my next word — that is
    // what makes the game self-paced: no waiting for the opponent.
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

    // Referee — any seated player runs it (polled 10x/sec, idempotent):
    // ends the game the moment a board win shows up, and judges by correct
    // answers once BOTH players have walked the whole list. Self-pacing
    // means there is no turn to settle and no forfeit bookkeeping: a player
    // who stops answering just stops dealing themselves words, and their
    // opponent is never blocked.
    referee: () => {
      const st = get();
      const r = st.room;
      if (!r || !st.uid) return;
      if (!slotOf(r, st.uid)) return;
      if (r.status !== "playing") return;

      const board = r.board ?? createBoard();
      const winnerMark = checkWinner(board);
      if (winnerMark) {
        const winner: Winner = winnerMark === "X" ? "p1" : "p2";
        act(`end-${winnerMark}-${r.moves?.length ?? 0}`, () =>
          endGame(r.code, winner)
        );
        return;
      }

      const exhausted = (k: SlotKey) =>
        (r.players[k]?.wordIndex ?? 0) >= r.words.length;
      if (exhausted("p1") && r.players.p2 != null && exhausted("p2")) {
        // The words ran dry before a 3-in-a-row: most correct answers wins
        // (the counts are final here — each player's last answer landed in
        // the same write that exhausted their pointer).
        const c1 = r.players.p1?.correctIdx?.length ?? 0;
        const c2 = r.players.p2?.correctIdx?.length ?? 0;
        const winner: Winner = c1 === c2 ? "draw" : c1 > c2 ? "p1" : "p2";
        act(`end-judge-${c1}-${c2}`, () => endGame(r.code, winner));
      }
    },

    submitPlayer,

    placeMyMark: async (cell) => {
      const st = get();
      const r = st.room;
      const myUid = st.uid;
      if (!r || r.status !== "playing" || !myUid) return;
      const key = slotOf(r, myUid);
      if (!key) return;
      const my = r.players[key];
      if (!my?.lastAnswer?.correct) return;
      if (!st.view?.pendingPlacement) return;
      const board = r.board ?? createBoard();
      if (cell < 0 || cell >= board.length || board[cell] !== "") return;
      // Block double taps before the transaction's snapshot lands; if the
      // placement didn't land (cell taken by a simultaneous opponent
      // placement), re-open so the refreshed board can be re-tapped.
      if (st.placedWord === my.lastAnswer.wordIndex) return;
      set({ placedWord: my.lastAnswer.wordIndex });
      let landed = false;
      try {
        landed = await placeMark(r.code, key, cell, my.lastAnswer.wordIndex);
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
      // Only record games seen live, never a replay of a finished room,
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
