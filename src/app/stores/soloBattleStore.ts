"use client";

import { create } from "zustand";
import { computeHit, clampElapsed } from "../../game/damage";
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
import type { AnswerState, BattleWord, Popup, Word } from "../../game/types";
import {
  MAX_HP,
  POPUP_LIFETIME_MS,
  TURN_MS,
  WORDS_PER_BATTLE,
  WRONG_ANSWER_HIT,
} from "../../lib/gameConfig";
import {
  loadBattleSummary,
  saveBattleSummary,
  type BattleWordDetail,
} from "../../game/battleSummary";
import { recordResult } from "../../game/progressService";
import { loadWordPool, pickBattleWords } from "../../game/wordPool";
import type { BattleOutcome, BattleView } from "./roomBattleStore";

// All solo-battle logic in one store — game decisions AND the React-facing
// projections (view, phase). The store owns its own damage popups, the bot's
// whole clock, and the imperative resources (runner, timers, pool/stats
// cache, record-once flag) as module state. Pages consume the store directly:
// read `view`/`phase`, call actions, and only supply the lifecycle effects.
// Lives in src/app/ — src/game/ stays framework-free.
type SoloBattleState = {
  error: string | null;
  words: BattleWord[];
  wordIndex: number;
  wordResults: (boolean | null)[];
  // Per-word 2-option grade (true = instant/mastered, false = retry) for the
  // progress pips; solo battles know the response time, PvP does not.
  wordMarks: (boolean | null)[];
  botHp: number;
  myHp: number;
  botStreak: number;
  streak: number;
  bestStreak: number;
  // True while the bot has an unanswered word on its desk — drives the
  // "thinking" chip so its deliberation is visible, not just a silent timer.
  botThinking: boolean;
  startedAt: number | null;
  selected: string | null;
  answerState: AnswerState;
  outcome: BattleOutcome;
  // Brain input: the player's recent answer times (pace pressure) — the bot
  // reads their average to decide how to play the next word.
  playerTimes: number[];
  wordDetails: BattleWordDetail[];
  // SRS buffer drained by recordOutcome (wordProgress needs ms/timeout,
  // which the summary's wordDetails deliberately don't carry).
  results: WordResult[];
  // React-facing projections, recomputed by commit() after every mutation.
  view: BattleView | null;
  phase: "loading" | "error" | "playing";
  popups: Popup[];
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
  botHp: SOLO_BOT.hp,
  myHp: MAX_HP,
  botStreak: 0,
  streak: 0,
  bestStreak: 0,
  botThinking: false,
  startedAt,
  selected: null,
  answerState: "idle",
  outcome: null,
  playerTimes: [],
  wordDetails: [],
  results: [],
  view: null,
  phase: "loading",
  popups: [],
});

function buildSoloView(s: SoloBattleState): BattleView {
  return {
    myName: "YOU",
    oppName: SOLO_BOT.name,
    myHp: s.myHp,
    oppHp: s.botHp,
    myStreak: s.streak,
    oppStreak: s.botStreak,
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
    popups: s.popups,
    outcome: s.outcome,
  };
}

// Imperative resources — never rendered, never mirrored in React.
let runner: BotRunner | null = null;
let timers: number[] = [];
let pool: Word[] = [];
let stats: WordStats = {};
let recorded = false;

const clearTimers = () => {
  timers.forEach((t) => window.clearTimeout(t));
  timers = [];
};

// Only the page-facing surface: lifecycle effects plus the answer entry
// points. Everything else (dealing, bot clock, grading, advancing) stays
// store-internal and never reaches React.
type SoloBattleActions = {
  mount: () => Promise<void>;
  unmount: () => void;
  // Deadline interval tick: fires the timeout exactly once per word.
  tick: () => void;
  submitPlayer: (answer: string | null) => void;
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

    const spawnPopup = (side: Popup["side"], damage: number, crit: boolean) => {
      const popup: Popup = {
        id: Date.now() + Math.random(),
        side,
        damage,
        crit,
      };
      commit({ popups: [...get().popups.slice(-4), popup] });
      window.setTimeout(() => {
        commit({
          popups: get().popups.filter((p) => p.id !== popup.id),
        });
      }, POPUP_LIFETIME_MS);
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
      // Feed the brain the live context (HP race, streaks, player pace,
      // word length); it decides mood, accuracy and think time and fires
      // the answer itself. If the player resolves the word first,
      // submitPlayer hands the pending answer to the lag path — exactly
      // one resolution per word.
      ensureRunner().schedule(wordIndex, {
        config: SOLO_BOT,
        botHpRatio: st.botHp / SOLO_BOT.hp,
        playerHpRatio: st.myHp / MAX_HP,
        botStreak: st.botStreak,
        playerStreak: st.streak,
        playerPaceMs: st.playerTimes.length
          ? Math.round(
              st.playerTimes.reduce((s, t) => s + t, 0) / st.playerTimes.length
            )
          : null,
        wordLength: current?.word.length ?? 6,
      });
      if (!get().outcome) commit({ botThinking: true });
    };

    const botAnswer = (answer: PendingBotAnswer) => {
      const state = get();
      // Once decided the battle is frozen: late lag answers can't touch it.
      if (state.outcome) return;
      if (answer.correct) {
        // computeHit can only return null past the turn deadline, which
        // the bot's think time never reaches — guarded anyway to mirror
        // damage.ts.
        const hit = computeHit(answer.thinkMs, state.botStreak);
        if (!hit) {
          commit({ botThinking: false });
          return;
        }
        spawnPopup("me", hit.damage, hit.crit);
        const myHp = Math.max(0, state.myHp - hit.damage);
        commit({
          botThinking: false,
          botStreak: state.botStreak + 1,
          myHp,
          outcome: myHp <= 0 ? "lose" : null,
        });
      } else {
        // The bot pays for its own misses — same price the player pays —
        // so its ~15 HP of self-damage per battle is part of the KO race.
        spawnPopup("opp", WRONG_ANSWER_HIT, false);
        const botHp = Math.max(0, state.botHp - WRONG_ANSWER_HIT);
        commit({
          botThinking: false,
          botStreak: 0,
          botHp,
          outcome: botHp <= 0 ? "win" : null,
        });
      }
    };

    const submitAnswer = (answer: string | null, now: number) => {
      const state = get();
      if (state.outcome || state.answerState !== "idle") return;
      const current = state.words[state.wordIndex];
      if (!current) return;

      const elapsed = clampElapsed(
        state.startedAt == null ? TURN_MS : now - state.startedAt
      );
      const timeout = answer == null;
      const correct = !timeout && answer === current.correctAnswer;
      // Response time + timeout flag drive the 2-option SRS grade in
      // wordProgress: instant (<2s) masters the word, everything else is a
      // retry that keeps it in Pool B for active review.
      const instant = gradeAnswer(correct, elapsed, timeout) === "instant";
      // A timeout is an absence of an answer, not a slow one — it never
      // feeds the player's pace.
      const playerTimes = timeout
        ? state.playerTimes
        : [...state.playerTimes, elapsed].slice(-5);
      const streak = correct ? state.streak + 1 : 0;

      let dealt = 0;
      if (correct) {
        const hit = computeHit(elapsed, state.streak);
        if (hit) {
          dealt = hit.damage;
          spawnPopup("opp", hit.damage, hit.crit);
        }
      } else {
        spawnPopup("me", WRONG_ANSWER_HIT, false);
      }
      const botHp = correct ? Math.max(0, state.botHp - dealt) : state.botHp;
      const myHp = correct
        ? state.myHp
        : Math.max(0, state.myHp - WRONG_ANSWER_HIT);

      const wordResults = [...state.wordResults];
      wordResults[state.wordIndex] = correct;
      const wordMarks = [...state.wordMarks];
      wordMarks[state.wordIndex] = instant;

      commit({
        selected: answer ?? "",
        answerState: correct ? "correct" : timeout ? "timeout" : "wrong",
        playerTimes,
        streak,
        bestStreak: Math.max(state.bestStreak, streak),
        botHp,
        myHp,
        wordResults,
        wordMarks,
        wordDetails: [
          ...state.wordDetails,
          {
            word: current.word,
            type: current.type,
            pronounceURL: current.pronounceURL,
            answer: current.correctAnswer,
            correct,
            instant,
            dealt: state.botHp - botHp,
            taken: state.myHp - myHp,
          },
        ],
        results: [
          ...state.results,
          { word: current.word, correct, ms: elapsed, timeout },
        ],
      });
    };

    const advance = (now: number) => {
      const state = get();
      if (state.outcome) return;
      // KO checks run here, one settle window after the word resolved, so
      // the bot's lag answer can still land (and KO) during it.
      if (state.botHp <= 0) {
        commit({ outcome: "win" });
        return;
      }
      if (state.myHp <= 0) {
        commit({ outcome: "lose" });
        return;
      }
      if (state.wordIndex + 1 >= state.words.length) {
        commit({
          outcome:
            state.myHp / MAX_HP > state.botHp / SOLO_BOT.hp ? "win" : "lose",
        });
        return;
      }
      commit({
        wordIndex: state.wordIndex + 1,
        selected: null,
        answerState: "idle",
        startedAt: now,
      });
    };

    const submitPlayer = (answer: string | null) => {
      const st = get();
      if (st.answerState !== "idle" || st.outcome) return;
      if (!st.words[st.wordIndex]) return;

      // The store action grades the pick, deals damage and spawns the
      // popup from one snapshot.
      submitAnswer(answer, Date.now());

      // The player resolved the word first: the runner kills its natural
      // timer and lands the in-flight decision a beat later on the bot's
      // own clock, so the two answers never resolve in the same instant —
      // like two humans committing at slightly different moments.
      ensureRunner().lagResolve(st.wordIndex);

      // Same settle window as before: KO checks wait 900ms, then either
      // the battle ends or the next word starts (advance decides which).
      const t = window.setTimeout(() => {
        advance(Date.now());
        const after = get();
        if (!after.outcome) scheduleBotTurn(after.wordIndex);
      }, 900);
      timers.push(t);
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
        bestStreak: st.bestStreak,
        damageDealt: details.reduce((sum, w) => sum + w.dealt, 0),
        damageTaken: details.reduce((sum, w) => sum + w.taken, 0),
        words: details,
      });
      recordResult(st.outcome, st.streak).catch((e) =>
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
          // battle's summary is the only record of what was just played —
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
      recordOutcome,
    };
  }
);
