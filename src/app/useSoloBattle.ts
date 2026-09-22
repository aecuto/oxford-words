"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeHit, clampElapsed } from "../game/damage";
import { loadWordPool, pickBattleWords } from "../game/wordPool";
import { recordResult } from "../game/progressService";
import {
  loadWordStats,
  saveWordResults,
  type WordResult,
  type WordStats,
} from "../game/wordProgress";
import type { AnswerState, BattleWord } from "../game/types";
import {
  MAX_HP,
  SOLO_BOT,
  TURN_MS,
  WORDS_PER_BATTLE,
  WRONG_ANSWER_HIT,
  botConfigFor,
  type SoloDifficulty,
} from "../lib/gameConfig";
import { saveBattleSummary, type BattleWordDetail } from "../game/battleSummary";
import { useCountdown } from "./useCountdown";
import { useDamagePopups } from "./useDamagePopups";
import type { BattleOutcome } from "./useBattleRoom";

type PendingBotAnswer = {
  wordIndex: number;
  correct: boolean;
  thinkMs: number;
};

export function useSoloBattle(difficulty: SoloDifficulty = "easy") {
  const bot = botConfigFor(difficulty);

  const [words, setWords] = useState<BattleWord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [wordIndex, setWordIndex] = useState(0);
  const [wordResults, setWordResults] = useState<(boolean | null)[]>([]);
  const [botHp, setBotHp] = useState<number>(bot.hp);
  const [myHp, setMyHp] = useState(MAX_HP);
  const [botStreak, setBotStreak] = useState(0);
  const [streak, setStreak] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [answerState, setAnswerState] = useState<AnswerState>("idle");
  const [outcome, setOutcome] = useState<BattleOutcome>(null);

  const timersRef = useRef<number[]>([]);
  const botTimerRef = useRef<number | null>(null);
  const pendingBotRef = useRef<PendingBotAnswer | null>(null);
  const outcomeRef = useRef<BattleOutcome>(null);
  // HP lives in refs too: the bot can land damage at any point mid-turn, so
  // outcome decisions must never read a stale state closure.
  const myHpRef = useRef(MAX_HP);
  const botHpRef = useRef(bot.hp);
  const botStreakRef = useRef(0);
  const bestStreakRef = useRef(0);
  const wordsRef = useRef<BattleWord[]>([]);
  const wordDetailsRef = useRef<BattleWordDetail[]>([]);
  const recordedRef = useRef(false);
  const poolRef = useRef<Awaited<ReturnType<typeof loadWordPool>>>([]);
  const statsRef = useRef<WordStats>({});
  const resultsRef = useRef<WordResult[]>([]);

  const { popups, spawnPopup, clearPopups } = useDamagePopups();
  const remainingMs = useCountdown(startedAt, TURN_MS);

  const endBattle = useCallback((next: BattleOutcome) => {
    outcomeRef.current = next;
    setOutcome(next);
  }, []);

  const applyBotAnswer = useCallback(
    (p: PendingBotAnswer) => {
      if (outcomeRef.current) return;
      if (p.correct) {
        const res = computeHit(p.thinkMs, botStreakRef.current);
        if (!res) return;
        botStreakRef.current += 1;
        setBotStreak(botStreakRef.current);
        myHpRef.current = Math.max(0, myHpRef.current - res.damage);
        setMyHp(myHpRef.current);
        spawnPopup("me", res.damage, res.crit);
        if (myHpRef.current <= 0) endBattle("lose");
      } else {
        botStreakRef.current = 0;
        setBotStreak(0);
        // Only the hard bot plays by player rules: its misses hurt it. The
        // easy bot barely aims, so punishing its misses would end battles
        // before they start.
        if (difficulty !== "hard") return;
        botHpRef.current = Math.max(0, botHpRef.current - WRONG_ANSWER_HIT);
        setBotHp(botHpRef.current);
        spawnPopup("opp", WRONG_ANSWER_HIT, false);
        if (botHpRef.current <= 0) endBattle("win");
      }
    },
    [endBattle, spawnPopup, difficulty]
  );

  // Pre-roll the bot's answer for the word and land it after its own think
  // time. If the player resolves the word first, finishWord applies the
  // pending answer instead — exactly one resolution per word.
  const scheduleBotTurn = useCallback(
    (forWordIndex: number) => {
      if (botTimerRef.current != null) window.clearTimeout(botTimerRef.current);
      const correct = Math.random() < bot.accuracy;
      const thinkMs = Math.round(
        bot.minThinkMs + Math.random() * (bot.maxThinkMs - bot.minThinkMs)
      );
      pendingBotRef.current = { wordIndex: forWordIndex, correct, thinkMs };
      botTimerRef.current = window.setTimeout(() => {
        const p = pendingBotRef.current;
        if (!p || p.wordIndex !== forWordIndex) return;
        pendingBotRef.current = null;
        applyBotAnswer(p);
      }, thinkMs);
    },
    [applyBotAnswer, bot.accuracy, bot.minThinkMs, bot.maxThinkMs]
  );

  const reset = useCallback(() => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
    if (botTimerRef.current != null) window.clearTimeout(botTimerRef.current);
    botTimerRef.current = null;
    pendingBotRef.current = null;
    outcomeRef.current = null;
    myHpRef.current = MAX_HP;
    botHpRef.current = bot.hp;
    botStreakRef.current = 0;
    bestStreakRef.current = 0;
    wordsRef.current = [];
    wordDetailsRef.current = [];
    recordedRef.current = false;
    resultsRef.current = [];
    clearPopups();
    setWordIndex(0);
    setBotHp(bot.hp);
    setMyHp(MAX_HP);
    setBotStreak(0);
    setStreak(0);
    setSelected(null);
    setAnswerState("idle");
    setOutcome(null);
    if (poolRef.current.length) {
        const picked = pickBattleWords(
          poolRef.current,
          WORDS_PER_BATTLE,
          statsRef.current
        );
        wordsRef.current = picked;
        wordDetailsRef.current = [];
        setWords(picked);
      setWordResults(new Array(picked.length).fill(null));
      setStartedAt(Date.now());
      scheduleBotTurn(0);
    }
  }, [clearPopups, scheduleBotTurn, bot.hp]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const pool = await loadWordPool();
        if (!alive) return;
        const stats = loadWordStats();
        poolRef.current = pool;
        statsRef.current = stats;
        const picked = pickBattleWords(pool, WORDS_PER_BATTLE, stats);
        wordsRef.current = picked;
        setWords(picked);
        setWordResults(new Array(picked.length).fill(null));
        setStartedAt(Date.now());
        scheduleBotTurn(0);
      } catch (e) {
        console.error(e);
        if (alive) setError("Could not load the word list.");
      }
    })();
    return () => {
      alive = false;
      timersRef.current.forEach((t) => window.clearTimeout(t));
      if (botTimerRef.current != null) window.clearTimeout(botTimerRef.current);
    };
  }, [scheduleBotTurn]);

  const finishWord = useCallback(
    (
      result: "correct" | "wrong" | "timeout",
      dealtDamage: number,
      crit: boolean,
      nextStreak: number
    ) => {
      const current = words[wordIndex];
      const isLast = wordIndex + 1 >= words.length;
      const beforeMy = myHpRef.current;
      const beforeBot = botHpRef.current;

      if (current) {
        resultsRef.current.push({
          word: current.word,
          correct: result === "correct",
        });
        setWordResults((prev) => {
          const next = [...prev];
          next[wordIndex] = result === "correct";
          return next;
        });
      }

      // Resolve the bot's pending answer for this word before settling HP so
      // the outcome below always sees both players' damage.
      const pending = pendingBotRef.current;
      if (pending && pending.wordIndex === wordIndex) {
        pendingBotRef.current = null;
        applyBotAnswer(pending);
      }

      if (result === "correct") {
        botHpRef.current = Math.max(0, botHpRef.current - dealtDamage);
        setBotHp(botHpRef.current);
        spawnPopup("opp", dealtDamage, crit);
      } else {
        myHpRef.current = Math.max(0, myHpRef.current - SOLO_BOT.hit);
        setMyHp(myHpRef.current);
        spawnPopup("me", SOLO_BOT.hit, false);
      }
      setStreak(nextStreak);
      if (nextStreak > bestStreakRef.current) bestStreakRef.current = nextStreak;
      if (current) {
        wordDetailsRef.current.push({
          word: current.word,
          pronounce: current.pronounce,
          answer: current.correctAnswer,
          correct: result === "correct",
          dealt: beforeBot - botHpRef.current,
          taken: beforeMy - myHpRef.current,
        });
      }

      const t = window.setTimeout(() => {
        if (outcomeRef.current) return;
        if (botHpRef.current <= 0) {
          endBattle("win");
          return;
        }
        if (myHpRef.current <= 0) {
          endBattle("lose");
          return;
        }
        if (isLast) {
          endBattle(
            myHpRef.current / MAX_HP > botHpRef.current / bot.hp
              ? "win"
              : "lose"
          );
          return;
        }
        const next = wordIndex + 1;
        setWordIndex(next);
        setSelected(null);
        setAnswerState("idle");
        setStartedAt(Date.now());
        scheduleBotTurn(next);
      }, 900);
      timersRef.current.push(t);
    },
    [
      words,
      wordIndex,
      spawnPopup,
      applyBotAnswer,
      scheduleBotTurn,
      endBattle,
      bot.hp,
    ]
  );

  const submit = useCallback(
    (answer: string | null) => {
      if (answerState !== "idle" || outcome || outcomeRef.current) return;
      const current = words[wordIndex];
      if (!current) return;

      const elapsed = clampElapsed(
        startedAt == null ? TURN_MS : Date.now() - startedAt
      );
      const timeout = answer == null;
      const correct = !timeout && answer === current.correctAnswer;

      setSelected(answer ?? "");

      if (correct) {
        const res = computeHit(elapsed, streak);
        const dealt = res?.damage ?? 0;
        setAnswerState("correct");
        finishWord("correct", dealt, res?.crit ?? false, streak + 1);
      } else {
        setAnswerState(timeout ? "timeout" : "wrong");
        finishWord(timeout ? "timeout" : "wrong", 0, false, 0);
      }
    },
    [answerState, outcome, words, wordIndex, startedAt, streak, finishWord]
  );

  useEffect(() => {
    if (remainingMs > 0 || outcome || !startedAt) return;
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot: auto-submit when the turn timer expires */
    submit(null);
  }, [remainingMs, outcome, startedAt, wordIndex, submit]);

  useEffect(() => {
    if (!outcome || recordedRef.current) return;
    recordedRef.current = true;
    const words = wordDetailsRef.current;
    saveBattleSummary({
      outcome,
      mode: "solo",
      difficulty,
      opponent: bot.name,
      total: wordsRef.current.length,
      answered: words.length,
      correct: words.filter((w) => w.correct).length,
      bestStreak: bestStreakRef.current,
      damageDealt: words.reduce((sum, w) => sum + w.dealt, 0),
      damageTaken: words.reduce((sum, w) => sum + w.taken, 0),
      words,
    });
    recordResult(outcome, streak).catch((e) =>
      console.error("progress:record", e)
    );
    if (resultsRef.current.length) {
      statsRef.current = saveWordResults(resultsRef.current);
      resultsRef.current = [];
    }
  }, [outcome, streak, difficulty, bot.name]);

  const view = useMemo(() => {
    const current = words[wordIndex] ?? null;
    return {
      myName: "YOU",
      oppName: bot.name,
      myHp,
      oppHp: botHp,
      myStreak: streak,
      oppStreak: botStreak,
      word: current,
      wordNumber: wordIndex + 1,
      wordTotal: words.length,
      wordResults,
      selected,
      answerState,
      waitingOpp: false,
      remainingMs,
      popups,
      outcome,
    };
  }, [
    words,
    wordIndex,
    wordResults,
    myHp,
    botHp,
    streak,
    botStreak,
    bot.name,
    selected,
    answerState,
    remainingMs,
    popups,
    outcome,
  ]);

  return {
    phase: error ? "error" : !words.length ? "loading" : "playing",
    error,
    view,
    submit,
    reset,
  } as const;
}
