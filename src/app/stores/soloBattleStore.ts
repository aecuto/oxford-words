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
  applyPlacement,
  botPickCell,
  checkWinner,
  createBoard,
  markFor,
  nextToFade,
} from "../../game/tictactoe";
import type {
  AnswerState,
  BattleWord,
  Cell,
  Move,
  Word,
} from "../../game/types";
import {
  TURN_MS,
  WORDS_PER_BATTLE,
} from "../../lib/gameConfig";
import {
  loadBattleSummary,
  saveBattleSummary,
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

// Word flow per turn: player and bot race the same word; a correct answer
// earns one board placement (the player taps a cell, the bot picks via
// botPickCell). The word only advances once both have resolved it AND every
// earned placement is on the board, so the board is always consistent
// before the next word deals.
const SETTLE_MS = 900;

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
  // The bot's correct-answer total — the comparator if the word pool ever
  // runs dry before the board decides a winner.
  botCorrect: number;
  // The bot's grade for the CURRENT word (null = still resolving) — closes
  // the settle gate alongside the player's answerState.
  botCorrectCurrent: boolean | null;
  // True while the bot has an unanswered word on its desk — drives the
  // "thinking" chip so its deliberation is visible, not just a silent timer.
  botThinking: boolean;
  // True once I've answered the current word correctly and not yet tapped a
  // cell — the board is mine to place on.
  pendingPlacement: boolean;
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
  botCorrect: 0,
  botCorrectCurrent: null,
  botThinking: false,
  pendingPlacement: false,
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
  return {
    myName: "YOU",
    oppName: SOLO_BOT.name,
    myMark: markFor("p1"),
    oppMark: markFor("p2"),
    board: s.board,
    moves: s.moves,
    pendingPlacement:
      s.pendingPlacement && s.answerState === "correct" && s.outcome === null,
    myNextFade: nextToFade(s.board, s.moves, "p1"),
    oppNextFade: nextToFade(s.board, s.moves, "p2"),
    word: s.words[s.wordIndex] ?? null,
    wordNumber: s.wordIndex + 1,
    wordTotal: s.words.length,
    wordResults: s.wordResults,
    wordMarks: s.wordMarks,
    selected: s.selected,
    answerState: s.answerState,
    waitingOpp: false,
    // Solo only: the bot's deliberation is visible while its answer is pending.
    oppThinking: s.botThinking && s.outcome === null,
    turnStartedAt: s.startedAt,
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
  // Deadline interval tick: fires the timeout exactly once per word.
  tick: () => void;
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
      commit({ ...freshSoloBattle(words, startedAt), results: [] });
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
      // The bot places its earned mark in the same breath as its answer —
      // botPickCell keeps it deterministic-free to watch: win, block,
      // center, corner.
      let board = st.board;
      let moves = st.moves;
      if (answer.correct) {
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
        botCorrect: st.botCorrect + (answer.correct ? 1 : 0),
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
        // The deal ran dry: "infinite" tops up from the pool (holding out
        // everything already answered this game) — and only a truly dry
        // pool falls back to judging by correct answers.
        const answered = st.words.map((w) => w.word);
        const picked = pool.length
          ? pickBattleWords(pool, WORDS_PER_BATTLE, stats, answered)
          : [];
        if (picked.length) {
          commit({
            words: [...st.words, ...picked],
            wordResults: [
              ...st.wordResults,
              ...new Array<boolean | null>(picked.length).fill(null),
            ],
            wordMarks: [
              ...st.wordMarks,
              ...new Array<boolean | null>(picked.length).fill(null),
            ],
          });
        } else {
          const myCorrect = st.wordResults.filter((r) => r === true).length;
          commit({
            outcome:
              myCorrect > st.botCorrect
                ? "win"
                : myCorrect < st.botCorrect
                  ? "lose"
                  : "draw",
          });
          return;
        }
      }
      commit({
        wordIndex: st.wordIndex + 1,
        selected: null,
        answerState: "idle",
        botCorrectCurrent: null,
        pendingPlacement: false,
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
      if (st.pendingPlacement) return;
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
      const elapsed = Math.min(
        Math.max(st.startedAt == null ? TURN_MS : now - st.startedAt, 0),
        TURN_MS
      );
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
        pendingPlacement: correct,
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
      if (st.outcome || !st.pendingPlacement) return;
      const res = applyPlacement(st.board, st.moves, "p1", cell, st.wordIndex);
      if (!res) return;
      // A winning placement ends the game immediately — no settle beat.
      const winner = checkWinner(res.board);
      commit({
        board: res.board,
        moves: res.moves,
        pendingPlacement: false,
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
          // game's summary is the only record of what was just played —
          // hold those words out of the next deal (this replaces the old
          // reset action: a rematch is just a fresh mount).
          const prevWords = (loadBattleSummary()?.words ?? []).map(
            (w) => w.word
          );
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

      tick: () => {
        const st = get();
        if (st.outcome || st.answerState !== "idle" || st.startedAt == null) {
          return;
        }
        if (Date.now() < st.startedAt + TURN_MS) return;
        submitPlayer(null);
      },

      submitPlayer,
      placeMyMark,
      recordOutcome,
    };
  }
);
