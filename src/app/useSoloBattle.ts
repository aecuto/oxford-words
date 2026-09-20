"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeHit, clampElapsed } from "../game/damage";
import { feedbackFor, type Feedback } from "../game/feedback";
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
  SOLO_BOSS,
  TURN_MS,
  WORDS_PER_BATTLE,
} from "../lib/gameConfig";
import { useCountdown } from "./useCountdown";
import { useDamagePopups } from "./useDamagePopups";
import type { BattleOutcome } from "./useBattleRoom";

export function useSoloBattle() {
  const [words, setWords] = useState<BattleWord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [wordIndex, setWordIndex] = useState(0);
  const [wordResults, setWordResults] = useState<(boolean | null)[]>([]);
  const [bossHp, setBossHp] = useState<number>(SOLO_BOSS.hp);
  const [myHp, setMyHp] = useState(MAX_HP);
  const [streak, setStreak] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [answerState, setAnswerState] = useState<AnswerState>("idle");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [outcome, setOutcome] = useState<BattleOutcome>(null);

  const timersRef = useRef<number[]>([]);
  const recordedRef = useRef(false);
  const poolRef = useRef<Awaited<ReturnType<typeof loadWordPool>>>([]);
  const statsRef = useRef<WordStats>({});
  const resultsRef = useRef<WordResult[]>([]);

  const { popups, spawnPopup, clearPopups } = useDamagePopups();
  const remainingMs = useCountdown(startedAt, TURN_MS);

  const reset = useCallback(() => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
    recordedRef.current = false;
    resultsRef.current = [];
    clearPopups();
    setWordIndex(0);
    setBossHp(SOLO_BOSS.hp);
    setMyHp(MAX_HP);
    setStreak(0);
    setSelected(null);
    setAnswerState("idle");
    setFeedback(null);
    setOutcome(null);
    if (poolRef.current.length) {
      const picked = pickBattleWords(
        poolRef.current,
        WORDS_PER_BATTLE,
        statsRef.current
      );
      setWords(picked);
      setWordResults(new Array(picked.length).fill(null));
    }
      setStartedAt(Date.now());
  }, [clearPopups]);

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
        setWords(picked);
        setWordResults(new Array(picked.length).fill(null));
        setStartedAt(Date.now());
      } catch (e) {
        console.error(e);
        if (alive) setError("Could not load the word list.");
      }
    })();
    return () => {
      alive = false;
      timersRef.current.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const finishWord = useCallback(
    (
      result: "correct" | "wrong" | "timeout",
      dealtDamage: number,
      crit: boolean,
      nextStreak: number
    ) => {
      const current = words[wordIndex];
      const isLast = wordIndex + 1 >= words.length;

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

      let nextBoss = bossHp;
      let nextMy = myHp;
      if (result === "correct") {
        nextBoss = Math.max(0, bossHp - dealtDamage);
        setBossHp(nextBoss);
        spawnPopup("opp", dealtDamage, crit);
      } else {
        nextMy = Math.max(0, myHp - SOLO_BOSS.hit);
        setMyHp(nextMy);
        spawnPopup("me", SOLO_BOSS.hit, false);
      }
      setStreak(nextStreak);
      setFeedback(feedbackFor(result, crit));

      const t = window.setTimeout(() => {
        if (nextBoss <= 0) {
          setOutcome("win");
          return;
        }
        if (nextMy <= 0) {
          setOutcome("lose");
          return;
        }
        if (isLast) {
          setOutcome(
            nextMy / MAX_HP > nextBoss / SOLO_BOSS.hp ? "win" : "lose"
          );
          return;
        }
        setWordIndex((i) => i + 1);
        setSelected(null);
        setAnswerState("idle");
        setFeedback(null);
        setStartedAt(Date.now());
      }, 900);
      timersRef.current.push(t);
    },
    [words, wordIndex, bossHp, myHp, spawnPopup]
  );

  const submit = useCallback(
    (answer: string | null) => {
      if (answerState !== "idle" || outcome) return;
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
    recordResult(outcome, streak).catch((e) =>
      console.error("progress:record", e)
    );
    if (resultsRef.current.length) {
      statsRef.current = saveWordResults(resultsRef.current);
      resultsRef.current = [];
    }
  }, [outcome, streak]);

  const view = useMemo(() => {
    const current = words[wordIndex] ?? null;
    return {
      myName: "YOU",
      oppName: SOLO_BOSS.name,
      myHp,
      oppHp: bossHp,
      myStreak: streak,
      oppStreak: 0,
      word: current,
      wordNumber: wordIndex + 1,
      wordTotal: words.length,
      wordResults,
      selected,
      answerState,
      feedback,
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
    bossHp,
    streak,
    selected,
    answerState,
    feedback,
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
