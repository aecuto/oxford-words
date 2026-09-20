"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeHit, clampElapsed, deriveHp } from "../game/damage";
import { feedbackFor, type Feedback } from "../game/feedback";
import {
  advanceWord,
  endGame,
  getRoom,
  joinRoom,
  startGame,
  subscribeRoom,
  submitAnswer,
} from "../game/roomService";
import type {
  ClientRoom,
  Hit,
  LastAnswer,
  Popup,
  SlotKey,
} from "../game/types";
import { TURN_GRACE_MS, TURN_MS } from "../lib/gameConfig";
import { describeAuthError, ensureAnonAuth } from "../lib/firebase";
import { useCountdown } from "./useCountdown";
import { recordResult } from "../game/progressService";

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
  selected: string | null;
  answerState: "idle" | "correct" | "wrong" | "timeout";
  feedback: Feedback | null;
  waitingOpp: boolean;
  remainingMs: number;
  popups: Popup[];
  outcome: BattleOutcome;
};

export function useBattleRoom(code: string, name: string) {
  const [room, setRoom] = useState<ClientRoom | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [popups, setPopups] = useState<Popup[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const uidRef = useRef<string | null>(null);
  const roomRef = useRef<ClientRoom | null>(null);
  const nameRef = useRef(name);
  const hpLensRef = useRef<{ me: number; opp: number } | null>(null);
  const actingRef = useRef<Set<string>>(new Set());
  const submittedWordRef = useRef<number>(-1);
  const liveSeenRef = useRef(false);
  const recordedRoomRef = useRef<string | null>(null);

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

  const spawnPopup = useCallback((side: Popup["side"], damage: number, crit: boolean) => {
    const popup: Popup = { id: Date.now() + Math.random(), side, damage, crit };
    setPopups((prev) => [...prev.slice(-4), popup]);
    setTimeout(() => {
      setPopups((prev) => prev.filter((p) => p.id !== popup.id));
    }, 1100);
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

  useEffect(() => {
    let alive = true;
    let unsub: (() => void) | null = null;

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
          existing.players.p1?.uid !== myUid &&
          existing.players.p2?.uid !== myUid
        ) {
          if (existing.players.p2 === null && existing.status === "waiting") {
            await joinRoom(code, myUid, nameRef.current || "Player 2");
          } else {
            setError("This room is full.");
            return;
          }
        }

        unsub = subscribeRoom(code, (r) => {
          if (!alive) return;
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
        });
      } catch (e) {
        console.error(e);
        if (alive) {
          setError(describeAuthError(e));
        }
      }
    })();

    return () => {
      alive = false;
      unsub?.();
    };
  }, [code, damagePopupsFrom]);

  const isHost = room != null && uid != null && room.hostUid === uid;

  useEffect(() => {
    const r = room;
    if (!r || !isHost) return;
    if (r.status === "waiting" && r.players.p2 != null) {
      void acting("start", () => startGame(r.code));
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

      setFeedback(
        feedbackFor(correct ? "correct" : timeout ? "timeout" : "wrong", hit?.crit ?? false)
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
  }, [view, room, slotKey]);

  return {
    phase: error ? "error" : !view ? "loading" : room!.status,
    error,
    view,
    submit,
  } as const;
}

function byHp(hp1: number, hp2: number): "p1" | "p2" | "draw" {
  if (hp1 === hp2) return "draw";
  return hp1 > hp2 ? "p1" : "p2";
}
