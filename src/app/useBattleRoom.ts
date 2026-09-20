"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeHit, clampElapsed, deriveHp } from "../game/damage";
import { feedbackFor, type Feedback } from "../game/feedback";
import {
  advanceWord,
  endGame,
  getRoom,
  joinRoom,
  renamePlayer,
  startGame,
  subscribeRoom,
  submitAnswer,
} from "../game/roomService";
import type {
  AnswerState,
  ClientRoom,
  Hit,
  LastAnswer,
  Popup,
  SlotKey,
} from "../game/types";
import { TURN_GRACE_MS, TURN_MS, WORDS_PER_BATTLE } from "../lib/gameConfig";
import { describeAuthError, ensureAnonAuth } from "../lib/firebase";
import { useCountdown } from "./useCountdown";
import { useDamagePopups } from "./useDamagePopups";
import { recordResult } from "../game/progressService";
import { mergeWordLists, loadWordPool, pickBattleWords } from "../game/wordPool";
import { loadWordStats } from "../game/wordProgress";
import {
  saveWordResults,
  type WordResult,
} from "../game/wordProgress";

export type BattleOutcome = "win" | "lose" | "draw" | null;

export type BattleView = {
  myName: string;
  oppName: string;
  myHp: number;
  oppHp: number;
  myStreak: number;
  oppStreak: number;
  word: ClientRoom["words"][number] | null;
  wordNumber: number;
  wordTotal: number;
  wordResults?: (boolean | null)[];
  selected: string | null;
  answerState: AnswerState;
  feedback: Feedback | null;
  waitingOpp: boolean;
  remainingMs: number;
  popups: Popup[];
  outcome: BattleOutcome;
};

export function useBattleRoom(code: string) {
  const [room, setRoom] = useState<ClientRoom | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [needsJoin, setNeedsJoin] = useState(false);
  const [joining, setJoining] = useState(false);
  const { popups, spawnPopup } = useDamagePopups();

  const uidRef = useRef<string | null>(null);
  const roomRef = useRef<ClientRoom | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const hpLensRef = useRef<{ me: number; opp: number } | null>(null);
  const actingRef = useRef<Set<string>>(new Set());
  const submittedWordRef = useRef<number>(-1);
  const liveSeenRef = useRef(false);
  const recordedRoomRef = useRef<string | null>(null);
  const resultsRef = useRef<WordResult[]>([]);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  const slotKey: SlotKey | null = useMemo(() => {
    if (!room || !uid) return null;
    if (room.players.p1?.uid === uid) return "p1";
    if (room.players.p2?.uid === uid) return "p2";
    return null;
  }, [room, uid]);

  const acting = useCallback((key: string, fn: () => Promise<unknown>) => {
    if (actingRef.current.has(key)) return;
    actingRef.current.add(key);
    fn()
      .catch((e) => console.error(`battle:${key}`, e))
      .finally(() => actingRef.current.delete(key));
  }, []);

  const damagePopupsFrom = useCallback(
    (r: ClientRoom, key: SlotKey) => {
      const oppKey: SlotKey = key === "p1" ? "p2" : "p1";
      const myHits = r.players[key]?.hits ?? [];
      const oppHits = r.players[oppKey]?.hits ?? [];
      const lens = { me: oppHits.length, opp: myHits.length };
      const prev = hpLensRef.current;
      hpLensRef.current = lens;
      if (!prev) return;

      if (lens.opp > prev.opp) {
        const hit = myHits[lens.opp - 1];
        if (hit && hit.wordIndex === r.wordIndex) {
          spawnPopup("opp", hit.damage, hit.crit);
        }
      }
      if (lens.me > prev.me) {
        const hit = oppHits[lens.me - 1];
        if (hit && hit.wordIndex === r.wordIndex) {
          spawnPopup("me", hit.damage, hit.crit);
        }
      }
    },
    [spawnPopup]
  );

  const handleSnapshot = useCallback(
    (myUid: string, r: ClientRoom | null) => {
      setRoom(r);
      if (!r) {
        hpLensRef.current = null;
        return;
      }
      const key: SlotKey | null =
        r.players.p1?.uid === myUid
          ? "p1"
          : r.players.p2?.uid === myUid
            ? "p2"
            : null;
      if (!key) {
        hpLensRef.current = null;
        return;
      }
      damagePopupsFrom(r, key);
    },
    [damagePopupsFrom]
  );

  const watchRoom = useCallback(
    (myUid: string) => {
      unsubRef.current?.();
      unsubRef.current = subscribeRoom(code, (r) => handleSnapshot(myUid, r));
    },
    [code, handleSnapshot]
  );

  useEffect(() => {
    let alive = true;
    unsubRef.current = null;

    (async () => {
      try {
        const myUid = await ensureAnonAuth();
        if (!alive) return;
        uidRef.current = myUid;
        setUid(myUid);

        const existing = await getRoom(code);
        if (!alive) return;
        if (!existing) {
          setError("Room not found. Check the code or ask for a new link.");
          return;
        }
        if (
          existing.players.p1?.uid === myUid ||
          existing.players.p2?.uid === myUid
        ) {
          watchRoom(myUid);
          return;
        }
        if (existing.players.p2 !== null || existing.status !== "waiting") {
          setError("This room is full.");
          return;
        }
        setNeedsJoin(true);
      } catch (e) {
        console.error(e);
        if (alive) {
          setError(describeAuthError(e));
        }
      }
    })();

    return () => {
      alive = false;
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [code, watchRoom]);

  const join = useCallback(
    (joinName: string) => {
      const myUid = uidRef.current;
      if (!myUid || joining) return;
      setJoining(true);
      void (async () => {
        try {
          const pool = await loadWordPool();
          const myWords = pickBattleWords(
            pool,
            WORDS_PER_BATTLE,
            loadWordStats()
          );
          await joinRoom(code, myUid, joinName.trim() || "Player 2", myWords);
          watchRoom(myUid);
          setNeedsJoin(false);
        } catch (e) {
          console.error("battle:join", e);
          setError(describeAuthError(e));
        } finally {
          setJoining(false);
        }
      })();
    },
    [code, joining, watchRoom]
  );

  const isHost = room != null && uid != null && room.hostUid === uid;

  const rename = useCallback(
    (newName: string) => {
      const r = roomRef.current;
      const myUid = uidRef.current;
      if (!r || !myUid) return;
      const key: SlotKey | null =
        r.players.p1?.uid === myUid
          ? "p1"
          : r.players.p2?.uid === myUid
            ? "p2"
            : null;
      if (!key) return;
      void acting("rename", () => renamePlayer(r.code, key, newName));
    },
    [acting]
  );

  useEffect(() => {
    const r = room;
    if (!r || !isHost) return;
    if (r.status === "waiting" && r.players.p2 != null) {
      void acting("start", async () => {
        const merged = mergeWordLists(
          r.words,
          r.players.p2?.words ?? [],
          r.words.length || WORDS_PER_BATTLE
        );
        await startGame(r.code, merged);
      });
    }
  }, [room, isHost, acting]);

  useEffect(() => {
    const r = room;
    if (!r || !isHost || r.status !== "playing") return;
    if (r.turnStartedAt == null) return;

    const current = r.wordIndex;
    const answered = (k: SlotKey) =>
      r.players[k]?.lastAnswer?.wordIndex === current;
    const bothAnswered = answered("p1") && r.players.p2 != null && answered("p2");
    const expired = Date.now() > r.turnStartedAt + TURN_MS + TURN_GRACE_MS;
    if (!bothAnswered && !expired) return;

    const hp1 = deriveHp(r.players.p2?.hits ?? []);
    const hp2 = deriveHp(r.players.p1?.hits ?? []);
    const ko = hp1 <= 0 || hp2 <= 0;
    const lastWord = current + 1 >= r.words.length;

    const settleMs = bothAnswered && !expired ? 900 : 0;
    const timer = window.setTimeout(() => {
      if (ko || lastWord) {
        const winner =
          hp1 <= 0 && hp2 <= 0
            ? "draw"
            : hp1 <= 0
              ? "p2"
              : hp2 <= 0
                ? "p1"
                : byHp(hp1, hp2);
        void acting(`end-${current}`, () => endGame(r.code, winner));
      } else {
        void acting(`adv-${current}`, () => advanceWord(r.code, current + 1));
      }
    }, settleMs);
    return () => window.clearTimeout(timer);
  }, [room, isHost, acting]);

  const remainingMs = useCountdown(
    room?.status === "playing" ? room.turnStartedAt : null,
    TURN_MS
  );

  useEffect(() => {
    const r = roomRef.current;
    if (!r || r.status !== "playing" || remainingMs > 0) return;
    const key = slotKey;
    if (!key || !uid) return;
    const my = r.players[key];
    if (!my || my.lastAnswer?.wordIndex === r.wordIndex) return;
    if (submittedWordRef.current === r.wordIndex) return;
    submittedWordRef.current = r.wordIndex;
    const timedOutWord = r.words[r.wordIndex];
    if (timedOutWord) {
      resultsRef.current.push({ word: timedOutWord.word, correct: false });
    }
    void acting(`timeout-${r.wordIndex}`, () =>
      submitAnswer(
        r.code,
        key,
        { wordIndex: r.wordIndex, answer: "", correct: false, at: Date.now() },
        null,
        0
      )
    );
  }, [remainingMs, room, slotKey, uid, acting]);

  const feedbackResetKey = `${room?.wordIndex ?? "-"}|${room?.status ?? "-"}`;
  const [prevFeedbackResetKey, setPrevFeedbackResetKey] =
    useState(feedbackResetKey);
  if (prevFeedbackResetKey !== feedbackResetKey) {
    setPrevFeedbackResetKey(feedbackResetKey);
    setFeedback(null);
  }

  const submit = useCallback(
    async (answer: string | null) => {
      const r = roomRef.current;
      const myUid = uidRef.current;
      if (!r || r.status !== "playing" || !myUid) return;
      const key: SlotKey | null =
        r.players.p1?.uid === myUid ? "p1" : r.players.p2?.uid === myUid ? "p2" : null;
      if (!key) return;
      const my = r.players[key];
      if (!my || my.lastAnswer?.wordIndex === r.wordIndex) return;
      if (submittedWordRef.current === r.wordIndex) return;
      submittedWordRef.current = r.wordIndex;

      const current = r.words[r.wordIndex];
      if (!current) return;

      const elapsed = clampElapsed(
        r.turnStartedAt == null ? TURN_MS : Date.now() - r.turnStartedAt
      );
      const timeout = answer == null;
      const correct = !timeout && answer === current.correctAnswer;
      const streak = correct ? my.streak + 1 : 0;

      let hit: Hit | null = null;
      if (correct) {
        const res = computeHit(elapsed, my.streak);
        if (res) {
          hit = {
            wordIndex: r.wordIndex,
            damage: res.damage,
            crit: res.crit,
            at: Date.now(),
          };
        }
      }

      const lastAnswer: LastAnswer = {
        wordIndex: r.wordIndex,
        answer: answer ?? "",
        correct,
        at: Date.now(),
      };
      resultsRef.current.push({ word: current.word, correct });

      setFeedback(
        feedbackFor(
          correct ? "correct" : timeout ? "timeout" : "wrong",
          hit?.crit ?? false,
          hit?.damage ?? 0
        )
      );

      await submitAnswer(r.code, key, lastAnswer, hit, streak).catch((e) => {
        console.error("battle:submit", e);
        submittedWordRef.current = -1;
      });
    },
    []
  );

  const view: BattleView | null = useMemo(() => {
    if (!room || !slotKey) return null;
    const oppKey: SlotKey = slotKey === "p1" ? "p2" : "p1";
    const my = room.players[slotKey];
    const opp = room.players[oppKey];
    if (!my) return null;

    const myHp = deriveHp(opp?.hits ?? []);
    const oppHp = deriveHp(my.hits);
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

    return {
      myName: my.name,
      oppName: opp?.name ?? "Waiting...",
      myHp,
      oppHp,
      myStreak: my.streak,
      oppStreak: opp?.streak ?? 0,
      word: current,
      wordNumber: room.wordIndex + 1,
      wordTotal: room.words.length,
      wordResults: room.words.map((_, i) => {
        if (my.hits.some((h) => h.wordIndex === i)) return true;
        if (i === room.wordIndex) {
          return answeredCurrent ? my.lastAnswer!.correct : null;
        }
        return null;
      }),
      selected: answeredCurrent ? my.lastAnswer!.answer : null,
      answerState,
      feedback,
      waitingOpp: answeredCurrent && !oppAnswered && room.status === "playing",
      remainingMs,
      popups,
      outcome,
    };
  }, [room, slotKey, feedback, remainingMs, popups]);

  useEffect(() => {
    if (room?.status === "playing") liveSeenRef.current = true;
  }, [room]);

  useEffect(() => {
    const outcome = view?.outcome;
    if (!outcome || !room || !slotKey) return;
    if (!liveSeenRef.current) return;
    if (recordedRoomRef.current === room.code) return;
    recordedRoomRef.current = room.code;
    recordResult(outcome, room.players[slotKey]?.streak ?? 0).catch((e) =>
      console.error("progress:record", e)
    );
    if (resultsRef.current.length) {
      saveWordResults(resultsRef.current);
      resultsRef.current = [];
    }
  }, [view, room, slotKey]);

  return {
    phase: error ? "error" : needsJoin ? "join" : !view ? "loading" : room!.status,
    error,
    view,
    submit,
    rename,
    join,
    joining,
  } as const;
}

function byHp(hp1: number, hp2: number): "p1" | "p2" | "draw" {
  if (hp1 === hp2) return "draw";
  return hp1 > hp2 ? "p1" : "p2";
}
