"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeHit, clampElapsed } from "../game/damage";
import { feedbackFor, type Feedback } from "../game/feedback";
import { loadWordPool, pickBattleWords } from "../game/wordPool";
import type { BattleWord, Popup } from "../game/types";
import { MAX_HP, SOLO_BOSS, TURN_MS } from "../lib/gameConfig";
import { useCountdown } from "./useCountdown";
import type { BattleOutcome } from "./useBattleRoom";

export function useSoloBattle() {
  const [words, setWords] = useState<BattleWord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [wordIndex, setWordIndex] = useState(0);
  const [bossHp, setBossHp] = useState<number>(SOLO_BOSS.hp);
  const [myHp, setMyHp] = useState(MAX_HP);
  const [streak, setStreak] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [answerState, setAnswerState] = useState<
    "idle" | "correct" | "wrong" | "timeout"
  >("idle");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [popups, setPopups] = useState<Popup[]>([]);
  const [outcome, setOutcome] = useState<BattleOutcome>(null);

  const lockRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  const submittedAtRef = useRef(-1);

  const remainingMs = useCountdown(startedAt, TURN_MS);

  const spawnPopup = useCallback((side: Popup["side"], damage: number, crit: boolean) => {
    const popup: Popup = { id: Date.now() + Math.random(), side, damage, crit };
    setPopups((prev) => [...prev.slice(-4), popup]);
    window.setTimeout(() => {
      setPopups((prev) => prev.filter((p) => p.id !== popup.id));
    }, 1100);
  }, []);

  const reset = useCallback(() => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
    lockRef.current = false;
    submittedAtRef.current = -1;
    setWordIndex(0);
    setBossHp(SOLO_BOSS.hp);
    setMyHp(MAX_HP);
    setStreak(0);
    setSelected(null);
    setAnswerState("idle");
    setFeedback(null);
    setPopups([]);
    setOutcome(null);
    setStartedAt(Date.now());
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const pool = await loadWordPool();
        if (!alive) return;
        setWords(pickBattleWords(pool));
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

      lockRef.current = true;
      const t = window.setTimeout(() => {
        lockRef.current = false;
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
      if (lockRef.current || answerState !== "idle" || outcome) return;
      const current = words[wordIndex];
      if (!current) return;

      const elapsed = clampElapsed(
        startedAt == null ? TURN_MS : Date.now() - startedAt
      );
      const timeout = answer == null;
      const correct = !timeout && answer === current.correctAnswer;

      setSelected(answer ?? "");
      submittedAtRef.current = wordIndex;

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
    if (submittedAtRef.current === wordIndex) return;
    submit(null);
  }, [remainingMs, outcome, startedAt, wordIndex, submit]);

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
