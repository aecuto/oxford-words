"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeHit, clampElapsed } from "../game/damage";
import {
  createBotRunner,
  SOLO_BOT,
  type BotRunner,
  type PendingBotAnswer,
} from "../game/botBrain";
import { loadWordPool, pickBattleWords } from "../game/wordPool";
import { recordResult } from "../game/progressService";
import {
  gradeAnswer,
  loadWordStats,
  saveWordResults,
  type WordResult,
  type WordStats,
} from "../game/wordProgress";
import type { AnswerState, BattleWord } from "../game/types";
import {
  MAX_HP,
  TURN_MS,
  WORDS_PER_BATTLE,
  WRONG_ANSWER_HIT,
} from "../lib/gameConfig";
import { loadBattleSummary, saveBattleSummary, type BattleWordDetail } from "../game/battleSummary";
import { useDamagePopups } from "./useDamagePopups";
import type { BattleOutcome, BattleView } from "./useBattleRoom";

export function useSoloBattle() {
  const bot = SOLO_BOT;

  const [words, setWords] = useState<BattleWord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [wordIndex, setWordIndex] = useState(0);
  const [wordResults, setWordResults] = useState<(boolean | null)[]>([]);
  // Per-word 2-option grade (true = instant/mastered, false = retry) for the
  // progress pips; solo battles know the response time, PvP does not.
  const [wordMarks, setWordMarks] = useState<(boolean | null)[]>([]);
  const [botHp, setBotHp] = useState<number>(bot.hp);
  const [myHp, setMyHp] = useState(MAX_HP);
  const [botStreak, setBotStreak] = useState(0);
  const [streak, setStreak] = useState(0);
  // True while the bot has an unanswered word on its desk — drives the
  // "thinking" chip so its deliberation is visible, not just a silent timer.
  const [botThinking, setBotThinking] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [answerState, setAnswerState] = useState<AnswerState>("idle");
  const [outcome, setOutcome] = useState<BattleOutcome>(null);

  const timersRef = useRef<number[]>([]);
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
  // Brain inputs: the player's recent answer times (pace pressure) and their
  // live streak — the bot reads both to decide how to play the next word.
  const playerTimesRef = useRef<number[]>([]);
  const playerStreakRef = useRef(0);

  const { popups, spawnPopup, clearPopups } = useDamagePopups();

  const endBattle = useCallback((next: BattleOutcome) => {
    outcomeRef.current = next;
    setOutcome(next);
  }, []);

  const applyBotAnswer = useCallback(
    (p: PendingBotAnswer) => {
      if (outcomeRef.current) return;
      setBotThinking(false);
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
        // The bot pays for its own misses — same price the player pays — so
        // its ~15 HP of self-damage per battle is part of the KO-race math.
        botHpRef.current = Math.max(0, botHpRef.current - WRONG_ANSWER_HIT);
        setBotHp(botHpRef.current);
        spawnPopup("opp", WRONG_ANSWER_HIT, false);
        if (botHpRef.current <= 0) endBattle("win");
      }
    },
    [endBattle, spawnPopup]
  );

  // The bot's whole clock lives in the runner (botBrain): pending answer,
  // think timer, lag path. Created lazily on first use — never during render
  // — and kept for the hook's lifetime; applyBotAnswer is a stable callback
  // (endBattle/spawnPopup never change identity).
  const runnerRef = useRef<BotRunner | null>(null);
  const getRunner = useCallback(() => {
    if (!runnerRef.current) runnerRef.current = createBotRunner(applyBotAnswer);
    return runnerRef.current;
  }, [applyBotAnswer]);

  // Feed the brain the live context (HP race, streaks, player pace, word
  // length); it decides mood, accuracy and think time and fires the answer
  // itself. If the player resolves the word first, finishWord hands the
  // pending answer to the lag path — exactly one resolution per word.
  const scheduleBotTurn = useCallback(
    (forWordIndex: number) => {
      const current = wordsRef.current[forWordIndex];
      const times = playerTimesRef.current;
      getRunner().schedule(forWordIndex, {
        config: bot,
        botHpRatio: botHpRef.current / bot.hp,
        playerHpRatio: myHpRef.current / MAX_HP,
        botStreak: botStreakRef.current,
        playerStreak: playerStreakRef.current,
        playerPaceMs: times.length
          ? Math.round(times.reduce((s, t) => s + t, 0) / times.length)
          : null,
        wordLength: current?.word.length ?? 6,
      });
      setBotThinking(true);
    },
    [getRunner, bot]
  );

  const reset = useCallback(() => {
    // Words of the battle just played must not reappear in the next one.
    const prevWords = wordsRef.current.map((w) => w.word);
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
    getRunner().clear();
    outcomeRef.current = null;
    myHpRef.current = MAX_HP;
    botHpRef.current = bot.hp;
    botStreakRef.current = 0;
    bestStreakRef.current = 0;
    wordsRef.current = [];
    wordDetailsRef.current = [];
    recordedRef.current = false;
    resultsRef.current = [];
    playerTimesRef.current = [];
    playerStreakRef.current = 0;
    setBotThinking(false);
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
          statsRef.current,
          prevWords
        );
        wordsRef.current = picked;
        wordDetailsRef.current = [];
        setWords(picked);
      setWordResults(new Array(picked.length).fill(null));
      setWordMarks(new Array(picked.length).fill(null));
      setStartedAt(Date.now());
      scheduleBotTurn(0);
    }
  }, [clearPopups, scheduleBotTurn, getRunner, bot.hp]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const pool = await loadWordPool();
        if (!alive) return;
        const stats = loadWordStats();
        poolRef.current = pool;
        statsRef.current = stats;
        // Returning from the result page remounts this hook, so the last
        // battle's summary is the only record of what was just played.
        const prevWords = (loadBattleSummary()?.words ?? []).map((w) => w.word);
        const picked = pickBattleWords(pool, WORDS_PER_BATTLE, stats, prevWords);
        wordsRef.current = picked;
        setWords(picked);
        setWordResults(new Array(picked.length).fill(null));
        setWordMarks(new Array(picked.length).fill(null));
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
      getRunner().clear();
    };
  }, [scheduleBotTurn, getRunner]);

  const finishWord = useCallback(
    (
      result: "correct" | "wrong" | "timeout",
      dealtDamage: number,
      crit: boolean,
      nextStreak: number,
      ms: number
    ) => {
      const current = words[wordIndex];
      const isLast = wordIndex + 1 >= words.length;
      const beforeMy = myHpRef.current;
      const beforeBot = botHpRef.current;
      // Response time + timeout flag drive the 2-option SRS grade in
      // wordProgress: instant (<2s) masters the word, everything else is a
      // retry that keeps it in Pool B for active review.
      const instant = current
        ? gradeAnswer(result === "correct", ms, result === "timeout") ===
          "instant"
        : false;

      if (current) {
        resultsRef.current.push({
          word: current.word,
          correct: result === "correct",
          ms,
          timeout: result === "timeout",
        });
        setWordResults((prev) => {
          const next = [...prev];
          next[wordIndex] = result === "correct";
          return next;
        });
        setWordMarks((prev) => {
          const next = [...prev];
          next[wordIndex] = instant;
          return next;
        });
      }

      // The player resolved the word first: the runner kills its natural
      // timer and lands the in-flight decision a beat later on the bot's own
      // clock, so the two answers never resolve in the same instant — like
      // two humans committing at slightly different moments.
      getRunner().lagResolve(wordIndex);

      if (result === "correct") {
        botHpRef.current = Math.max(0, botHpRef.current - dealtDamage);
        setBotHp(botHpRef.current);
        spawnPopup("opp", dealtDamage, crit);
      } else {
        myHpRef.current = Math.max(0, myHpRef.current - WRONG_ANSWER_HIT);
        setMyHp(myHpRef.current);
        spawnPopup("me", WRONG_ANSWER_HIT, false);
      }
      setStreak(nextStreak);
      playerStreakRef.current = nextStreak;
      if (nextStreak > bestStreakRef.current) bestStreakRef.current = nextStreak;
      if (current) {
        wordDetailsRef.current.push({
          word: current.word,
          type: current.type,
          pronounceURL: current.pronounceURL,
          answer: current.correctAnswer,
          correct: result === "correct",
          instant,
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
      getRunner,
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
      // Feed the brain: real picks count toward the player's pace (a timeout
      // is an absence of an answer, not a slow one).
      if (!timeout) {
        playerTimesRef.current.push(elapsed);
        if (playerTimesRef.current.length > 5) playerTimesRef.current.shift();
      }

      if (correct) {
        const res = computeHit(elapsed, streak);
        const dealt = res?.damage ?? 0;
        setAnswerState("correct");
        finishWord("correct", dealt, res?.crit ?? false, streak + 1, elapsed);
      } else {
        setAnswerState(timeout ? "timeout" : "wrong");
        finishWord(timeout ? "timeout" : "wrong", 0, false, 0, elapsed);
      }
    },
    [answerState, outcome, words, wordIndex, startedAt, streak, finishWord]
  );

  // Turn deadline without per-tick renders: the interval only reads refs and
  // fires submit once at expiry, so the timer no longer re-renders the whole
  // battle screen 10x/sec (TimerBar animates itself).
  useEffect(() => {
    if (startedAt === null) return;
    const deadline = startedAt + TURN_MS;
    const id = window.setInterval(() => {
      if (outcomeRef.current || Date.now() < deadline) return;
      submit(null);
    }, 100);
    return () => window.clearInterval(id);
  }, [startedAt, submit]);

  useEffect(() => {
    if (!outcome || recordedRef.current) return;
    recordedRef.current = true;
    const words = wordDetailsRef.current;
    saveBattleSummary({
      outcome,
      mode: "solo",
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
  }, [outcome, streak, bot.name]);

  // Same shape useBattleRoom returns — BattleScreen is shared by both modes,
  // so the annotation keeps solo and PvP views structurally in sync.
  const view: BattleView = useMemo(() => {
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
      wordMarks,
      selected,
      answerState,
      waitingOpp: false,
      // Solo only: the bot's deliberation is visible while its answer is pending.
      oppThinking: botThinking && outcome === null,
      turnStartedAt: startedAt,
      popups,
      outcome,
    };
  }, [
    words,
    wordIndex,
    wordResults,
    wordMarks,
    myHp,
    botHp,
    streak,
    botStreak,
    bot.name,
    selected,
    answerState,
    botThinking,
    startedAt,
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
