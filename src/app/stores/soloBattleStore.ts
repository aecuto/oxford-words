"use client";

import { create } from "zustand";
import {
  createBotRunner,
  SOLO_BOT,
  type BotRunner,
  type PendingBotAnswer,
} from "../../game/botBrain";
import {
  gradeAnswer,
  loadWordStats,
  saveWordResults,
  type WordResult,
  type WordStats,
} from "../../game/wordProgress";
import {
  answerStreak,
  applyPlacement,
  botPickCell,
  checkWinner,
  createBoard,
  markFor,
  nextToFade,
  placementWords,
} from "../../game/tictactoe";
import type {
  AnswerState,
  BattleWord,
  Cell,
  Move,
  Word,
} from "../../game/types";
import { PLACEMENT_STREAK, WORDS_PER_BATTLE } from "../../lib/gameConfig";
import {
  loadBattleSummary,
  loadRecentBattleWords,
  saveBattleSummary,
  saveRecentBattleWords,
  type BattleWordDetail,
} from "../../game/battleSummary";
import { recordResult } from "../../game/progressService";
import { loadWordPool, pickBattleWords } from "../../game/wordPool";
import type { BattleOutcome, BattleView } from "./roomBattleStore";

// All solo-game logic in one store — game decisions AND the React-facing
// projections (view, phase). The store owns the bot's whole clock, the
// shared board and the imperative resources (runner, timers, pool/stats
// cache, record-once flag) as module state. Pages consume the store
// directly: read `view`/`phase`, call actions, and only supply the
// lifecycle effects. Lives in src/app/ — src/game/ stays framework-free.

// Word flow per turn: player and bot race the same word; every
// PLACEMENT_STREAK consecutive correct answers earns one board placement
// (the player taps a cell, the bot picks via botPickCell — a wrong or
// timed-out word resets the run). The word only advances once both have
// resolved it AND every earned placement is on the board, so the board is
// always consistent before the next word deals.
const SETTLE_MS = 900;

// The answered word my pending placement was earned on — null when nothing
// is pending. Derived, never stored: an earned placement stays claimable
// across word boundaries and only leaves once it lands on the board.
const pendingPlacementWord = (s: SoloBattleState): number | null =>
  s.outcome === null
    ? placementWords(s.wordResults).find(
        (i) => !s.moves.some((m) => m.slot === "p1" && m.wordIndex === i),
      ) ?? null
    : null;

type SoloBattleState = {
  error: string | null;
  words: BattleWord[];
  wordIndex: number;
  wordResults: (boolean | null)[];
  // Per-word 2-option grade (true = instant/mastered, false = retry) for the
  // progress pips; solo games know the response time, PvP does not.
  wordMarks: (boolean | null)[];
  board: Cell[];
  moves: Move[];
  // The bot's consecutive-correct run — every PLACEMENT_STREAK of these
  // earns it one placement, same rule as the player.
  botStreak: number;
  // The bot's grade for the CURRENT word (null = still resolving) — closes
  // the settle gate alongside the player's answerState.
  botCorrectCurrent: boolean | null;
  // True while the bot has an unanswered word on its desk — drives the
  // "thinking" chip so its deliberation is visible, not just a silent timer.
  botThinking: boolean;
  startedAt: number | null;
  selected: string | null;
  answerState: AnswerState;
  outcome: BattleOutcome;
  wordDetails: BattleWordDetail[];
  // SRS buffer drained by recordOutcome (wordProgress needs ms/timeout,
  // which the summary's wordDetails deliberately don't carry).
  results: WordResult[];
  // React-facing projections, recomputed by commit() after every mutation.
  view: BattleView | null;
  phase: "loading" | "error" | "playing";
};

const freshSoloBattle = (
  words: BattleWord[],
  startedAt: number | null
): SoloBattleState => ({
  error: null,
  words,
  wordIndex: 0,
  wordResults: new Array<boolean | null>(words.length).fill(null),
  wordMarks: new Array<boolean | null>(words.length).fill(null),
  board: createBoard(),
  moves: [],
  botStreak: 0,
  botCorrectCurrent: null,
  botThinking: false,
  startedAt,
  selected: null,
  answerState: "idle",
  outcome: null,
  wordDetails: [],
  results: [],
  view: null,
  phase: "loading",
});

function buildSoloView(s: SoloBattleState): BattleView {
  const placementWord = pendingPlacementWord(s);
  return {
    myName: "YOU",
    oppName: SOLO_BOT.name,
    myMark: markFor("p1"),
    oppMark: markFor("p2"),
    board: s.board,
    moves: s.moves,
    pendingPlacement: placementWord !== null,
    placementWord,
    myStreak: answerStreak(s.wordResults, s.wordIndex),
    myNextFade: nextToFade(s.board, s.moves, "p1"),
    oppNextFade: nextToFade(s.board, s.moves, "p2"),
    word: s.words[s.wordIndex] ?? null,
    wordNumber: s.wordIndex + 1,
    wordTotal: s.words.length,
    wordResults: s.wordResults,
    wordMarks: s.wordMarks,
    selected: s.selected,
    answerState: s.answerState,
    feedback: null,
    // Solo only: the bot's deliberation is visible while its answer is pending.
    oppThinking: s.botThinking && s.outcome === null,
    outcome: s.outcome,
  };
}

// Imperative resources — never rendered, never mirrored in React.
let runner: BotRunner | null = null;
let settleTimer: number | null = null;
let pool: Word[] = [];
let stats: WordStats = {};
let recorded = false;

const clearTimers = () => {
  if (settleTimer != null) {
    window.clearTimeout(settleTimer);
    settleTimer = null;
  }
};

// Only the page-facing surface: lifecycle effects plus the answer/placement
// entry points. Everything else (dealing, bot clock, grading, settling)
// stays store-internal and never reaches React.
type SoloBattleActions = {
  mount: () => Promise<void>;
  unmount: () => void;
  submitPlayer: (answer: string | null) => void;
  placeMyMark: (cell: number) => void;
  recordOutcome: () => void;
};

export const useSoloBattleStore = create<SoloBattleState & SoloBattleActions>()(
  (set, get) => {
    // Every mutation goes through commit: the projections (view, phase) are
    // recomputed from the merged state, so they can never drift.
    const commit = (partial: Partial<SoloBattleState>) => {
      const next = { ...get(), ...partial };
      set({
        ...partial,
        view: buildSoloView(next),
        phase: next.error
          ? "error"
          : !next.words.length
            ? "loading"
            : "playing",
      });
    };

    const ensureRunner = (): BotRunner => {
      if (!runner) {
        runner = createBotRunner((p) => botAnswer(p));
      }
      return runner;
    };

    const load = (words: BattleWord[], startedAt: number) => {
      recorded = false;
      commit(freshSoloBattle(words, startedAt));
    };

    const loadError = () => commit({ error: "Could not load the word list." });

    const scheduleBotTurn = (wordIndex: number) => {
      const st = get();
      const current = st.words[wordIndex];
      // The brain decides accuracy and think time and fires the answer
      // itself. If the player resolves the word first, submitPlayer hands
      // the pending answer to the lag path — exactly one resolution per
      // word.
      ensureRunner().schedule(wordIndex, {
        config: SOLO_BOT,
        wordLength: current?.word.length ?? 6,
      });
      if (!get().outcome) commit({ botThinking: true });
    };

    const botAnswer = (answer: PendingBotAnswer) => {
      const st = get();
      // Once decided the game is frozen: late lag answers can't touch it.
      if (st.outcome || answer.wordIndex !== st.wordIndex) return;
      // The bot's run earns it a placement only on every PLACEMENT_STREAK
      // consecutive correct — and it places in the same breath as its
      // answer: win, block, center, corner.
      const botStreak = answer.correct ? st.botStreak + 1 : 0;
      let board = st.board;
      let moves = st.moves;
      if (answer.correct && botStreak % PLACEMENT_STREAK === 0) {
        const cell = botPickCell(board, moves, "p2");
        const res = cell == null ? null : applyPlacement(board, moves, "p2", cell, st.wordIndex);
        if (res) {
          board = res.board;
          moves = res.moves;
        }
      }
      const winner = answer.correct ? checkWinner(board) : null;
      commit({
        botThinking: false,
        botCorrectCurrent: answer.correct,
        botStreak,
        board,
        moves,
        outcome: winner === "O" ? "lose" : null,
      });
      maybeSettle();
    };

    // Ends the battle or deals the next word — only called once both sides
    // have resolved the word and every earned placement is on the board.
    const finishWord = () => {
      const st = get();
      if (st.outcome) return;
      // Board safety net: a placement path that missed its own winner check.
      const winner = checkWinner(st.board);
      if (winner) {
        commit({ outcome: winner === "X" ? "win" : "lose" });
        return;
      }
      if (st.wordIndex + 1 >= st.words.length) {
        // The 20-word deal ran dry with no 3-in-a-row: a draw — no top-up
        // from the pool, no judging by correct answers.
        commit({ outcome: "draw" });
        return;
      }
      commit({
        wordIndex: st.wordIndex + 1,
        selected: null,
        answerState: "idle",
        botCorrectCurrent: null,
        startedAt: Date.now(),
      });
      scheduleBotTurn(get().wordIndex);
    };

    // Schedules the settle window once the word is fully resolved (both
    // answers in, no placement pending). Late events (the bot's lag answer,
    // a placement) restart it, so the feedback beat always plays in full.
    const maybeSettle = () => {
      const st = get();
      if (st.outcome) return;
      if (st.answerState === "idle") return;
      if (st.botCorrectCurrent === null) return;
      if (pendingPlacementWord(st) !== null) return;
      if (settleTimer != null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        settleTimer = null;
        finishWord();
      }, SETTLE_MS);
    };

    const submitPlayer = (answer: string | null) => {
      const st = get();
      if (st.answerState !== "idle" || st.outcome) return;
      const current = st.words[st.wordIndex];
      if (!current) return;

      const now = Date.now();
      // Response time since the word was dealt drives the 2-option SRS
      // grade in wordProgress: instant (<2s) masters the word, everything
      // else — slow, guess, wrong — is a retry that keeps it in Pool B.
      const elapsed = Math.max(st.startedAt == null ? 0 : now - st.startedAt, 0);
      const timeout = answer == null;
      const correct = !timeout && answer === current.correctAnswer;
      // Response time + timeout flag drive the 2-option SRS grade in
      // wordProgress: instant (<2s) masters the word, everything else is a
      // retry that keeps it in Pool B for active review.
      const instant = gradeAnswer(correct, elapsed, timeout) === "instant";

      const wordResults = [...st.wordResults];
      wordResults[st.wordIndex] = correct;
      const wordMarks = [...st.wordMarks];
      wordMarks[st.wordIndex] = instant;

      commit({
        selected: answer ?? "",
        answerState: correct ? "correct" : timeout ? "timeout" : "wrong",
        wordResults,
        wordMarks,
        wordDetails: [
          ...st.wordDetails,
          {
            word: current.word,
            type: current.type,
            pronounceURL: current.pronounceURL,
            answer: current.correctAnswer,
            correct,
            instant,
          },
        ],
        results: [
          ...st.results,
          { word: current.word, correct, ms: elapsed, timeout },
        ],
      });

      // The player resolved the word first: the runner kills its natural
      // timer and lands the in-flight decision a beat later on the bot's
      // own clock, so the two answers never resolve in the same instant —
      // like two humans committing at slightly different moments.
      ensureRunner().lagResolve(st.wordIndex);
      maybeSettle();
    };

    const placeMyMark = (cell: number) => {
      const st = get();
      if (st.outcome) return;
      // Place against the word the pending placement was earned on.
      const word = pendingPlacementWord(st);
      if (word === null) return;
      const res = applyPlacement(st.board, st.moves, "p1", cell, word);
      if (!res) return;
      // A winning placement ends the game immediately — no settle beat.
      const winner = checkWinner(res.board);
      commit({
        board: res.board,
        moves: res.moves,
        outcome: winner === "X" ? "win" : null,
      });
      maybeSettle();
    };

    const recordOutcome = () => {
      const st = get();
      if (!st.outcome || recorded) return;
      recorded = true;
      const details = st.wordDetails;
      saveBattleSummary({
        outcome: st.outcome,
        mode: "solo",
        opponent: SOLO_BOT.name,
        total: st.words.length,
        answered: details.length,
        correct: details.filter((w) => w.correct).length,
        words: details,
      });
      // The full dealt list joins the recent ring — next game holds it out.
      saveRecentBattleWords(st.words.map((w) => w.word));
      recordResult(st.outcome).catch((e) =>
        console.error("progress:record", e)
      );
      const drained = get().results;
      set({ results: [] });
      if (drained.length) {
        stats = saveWordResults(drained);
      }
    };

    return {
      ...freshSoloBattle([], null),

      mount: async () => {
        try {
          pool = await loadWordPool();
          stats = loadWordStats();
          // Returning from the result page remounts the page, so the last
          // game's summary is the only same-session record of what was just
          // played — union it with the recent-battles ring so the deal holds
          // out the last few games, not just the previous one (the SRS old
          // slots would otherwise pull those words straight back).
          const prevWords = [
            ...new Set([
              ...(loadBattleSummary()?.words ?? []).map((w) => w.word),
              ...loadRecentBattleWords(),
            ]),
          ];
          const picked = pickBattleWords(
            pool,
            WORDS_PER_BATTLE,
            stats,
            prevWords
          );
          load(picked, Date.now());
          scheduleBotTurn(0);
        } catch (e) {
          console.error(e);
          loadError();
        }
      },

      unmount: () => {
        clearTimers();
        runner?.clear();
      },

      submitPlayer,
      placeMyMark,
      recordOutcome,
    };
  }
);
