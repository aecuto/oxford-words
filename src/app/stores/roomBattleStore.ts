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
  answerStreak,
  checkWinner,
  completesStreak,
  createBoard,
  markFor,
  nextToFade,
  placementWords,
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
  loadRecentBattleWords,
  saveBattleSummary,
  saveRecentBattleWords,
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
  // I've earned a placement (PLACEMENT_STREAK consecutive correct answers)
  // and haven't tapped a cell for it — the board is mine to place on, and
  // play is gated on it: the next word only deals once the mark lands.
  pendingPlacement: boolean;
  // The answered word my pending placement was earned on; null when
  // nothing is pending. placeMyMark records the move against it.
  placementWord: number | null;
  // My current consecutive-correct run feeding the next placement.
  myStreak: number;
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
// clock, every answer deals that player their next word in the same write
// (a streak-completing answer holds that deal until its mark is placed),
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

// My result for a room in its current state — null while still playing.
function roomOutcome(room: ClientRoom, key: SlotKey | null): BattleOutcome {
  if (!key || room.status !== "ended") return null;
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
      placementWord: null,
      myStreak: 0,
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

  // My current word is whatever my own pointer says — the opponent's
  // progress never gates it. (?? 0 reads rooms created before the
  // self-paced schema; they can only be in ended/closed states anyway.)
  const myIdx = my.wordIndex ?? 0;
  const myWord = room.words[myIdx] ?? null;
  // Per-word results for both sides (null = not yet answered) — the same
  // list feeds the pips and the streak-based placement rules.
  const resultsFor = (p: ClientSlot | null): (boolean | null)[] =>
    room.words.map((_, i) =>
      p?.correctIdx?.includes(i) ? true : p?.wrongIdx?.includes(i) ? false : null
    );
  const wordResults = resultsFor(my);

  const outcome: BattleOutcome = roomOutcome(room, slotKey);

  // Every PLACEMENT_STREAK consecutive correct answers earns one placement.
  // An earned placement stays claimable across word boundaries — only
  // landing it on the board clears it — so pending is the earliest earned
  // word with no move of mine recorded for it.
  const placementWord =
    room.status === "playing" && outcome === null
      ? placementWords(wordResults).find(
          (i) => !moves.some((m) => m.slot === slotKey && m.wordIndex === i),
        ) ?? null
      : null;

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

  // The placement gate holds my pointer ON the answered word until my mark
  // lands: derive the frozen answered state so the grid can't be replayed
  // and shows the pick that completed the streak. (A pointer on an answered
  // word never persists otherwise — every non-gated answer advances it in
  // the same write.)
  const answeredCurrent =
    my.lastAnswer != null && my.lastAnswer.wordIndex === myIdx;
  const answerState: AnswerState = answeredCurrent
    ? my.lastAnswer!.correct
      ? "correct"
      : "wrong"
    : "idle";
  const selected = answeredCurrent ? my.lastAnswer!.answer || null : null;

  return {
    myName: my.name,
    oppName: opp?.name ?? "Waiting...",
    myMark: markFor(slotKey),
    oppMark: markFor(oppKey),
    board,
    moves,
    pendingPlacement: placementWord !== null,
    placementWord,
    myStreak: answerStreak(wordResults, myIdx),
    myNextFade: nextToFade(board, moves, slotKey),
    oppNextFade: nextToFade(board, moves, oppKey),
    word: myWord,
    wordNumber: Math.min(myIdx + 1, room.words.length),
    wordTotal: room.words.length,
    wordResults,
    selected,
    answerState,
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

    // One atomic write records the answer and — unless this answer just
    // completed a placement streak — deals my next word: that is what makes
    // the game self-paced, no waiting for the opponent. A held deal keeps
    // the pointer on the answered word; placeMark releases it, so the mark
    // must land before play continues.
    const results = r.words.map((_, i) =>
      my.correctIdx?.includes(i) ? true : my.wrongIdx?.includes(i) ? false : null
    );
    const dealNext = !completesStreak(results, myIdx, correct);
    await submitAnswer(r.code, key, lastAnswer, correct, dealNext).catch((e) => {
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
        // My recent-battles ring joins in, so words from my own last few
        // games stay out of the deal too.
        const shown = await getRoom(code);
        const excluded = [
          ...new Set([
            ...(shown?.words ?? []).map((w) => w.word),
            ...(shown?.players.p1?.words ?? []).map((w) => w.word),
            ...loadRecentBattleWords(),
          ]),
        ];
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
    // ends the game the moment a board win shows up, and calls the draw
    // once BOTH players have walked all WORDS_PER_BATTLE words with no
    // 3-in-a-row on the board — correct counts don't break the tie. Self-
    // pacing means there is no turn to settle and no forfeit bookkeeping:
    // a player who stops answering just stops dealing themselves words
    // (and can never finish their 20), so the opponent is never blocked.
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
        // The 20 shared words ran dry before anyone scored 3 in a row:
        // a draw.
        act("end-draw", () => endGame(r.code, "draw"));
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
      // The view already resolved which earned-but-unplaced word my tap
      // pays for; no earned placement, no board.
      const pendingWord = st.view?.placementWord ?? null;
      if (pendingWord === null) return;
      const board = r.board ?? createBoard();
      if (cell < 0 || cell >= board.length || board[cell] !== "") return;
      // Block double taps before the transaction's snapshot lands; if the
      // placement didn't land (cell taken by a simultaneous opponent
      // placement), re-open so the refreshed board can be re-tapped.
      if (st.placedWord === pendingWord) return;
      set({ placedWord: pendingWord });
      let landed = false;
      try {
        landed = await placeMark(r.code, key, cell, pendingWord);
      } catch (e) {
        console.error("battle:place", e);
      }
      if (!landed) set({ placedWord: -1 });
    },

    recordOutcome: () => {
      const st = get();
      const room = st.room;
      if (!room || !st.uid) return;
      const slotKey = slotOf(room, st.uid);
      if (!slotKey) return;
      const outcome = roomOutcome(room, slotKey);
      if (!outcome) return;
      // Only record games seen live, never a replay of a finished room,
      // and only once per room.
      if (!st.liveSeen) return;
      if (st.recordedRoom === room.code) return;
      set({ recordedRoom: room.code });
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
      // The full shared set — not just the words I answered — joins the
      // recent ring, so the rematch deal holds out every word both players
      // just saw. Both clients record the same set, so each player's ring
      // covers the room's history.
      saveRecentBattleWords(room.words.map((w) => w.word));
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
