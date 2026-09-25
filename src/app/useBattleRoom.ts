"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeHit, clampElapsed, deriveHp } from "../game/damage";
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
import { TURN_GRACE_MS, TURN_MS, WORDS_PER_BATTLE, WRONG_ANSWER_HIT } from "../lib/gameConfig";
import { describeAuthError, ensureAnonAuth } from "../lib/firebase";
import { useDamagePopups } from "./useDamagePopups";
import { recordResult } from "../game/progressService";
import { mergeWordLists, loadWordPool, pickBattleWords } from "../game/wordPool";
import { loadWordStats } from "../game/wordProgress";
import {
  saveWordResults,
  type WordResult,
} from "../game/wordProgress";
import { saveBattleSummary, type BattleWordDetail } from "../game/battleSummary";

export type BattleOutcome = "win" | "lose" | "draw" | null;

function penaltyHit(wordIndex: number): Hit {
  return {
    wordIndex,
    damage: WRONG_ANSWER_HIT,
    crit: false,
    at: Date.now(),
  };
}

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
  /** Per-word instant grade for the pips; solo only — PvP has no response times. */
  wordMarks?: (boolean | null)[];
  selected: string | null;
  answerState: AnswerState;
  waitingOpp: boolean;
  turnStartedAt: number | null;
  popups: Popup[];
  outcome: BattleOutcome;
};

export function useBattleRoom(code: string) {
  const [room, setRoom] = useState<ClientRoom | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  const bestStreakRef = useRef(0);
  const wordDetailsRef = useRef<
    { wordIndex: number; word: string; type?: string; correct: boolean }[]
  >([]);

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
          setError("Room not found or already closed. Join from the lobby list or ask for a new invite link.");
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
          // Words published on the room doc (the host's pick for the pending
          // battle, or the last battle's set on a rematch) must not reappear
          // in my half — I only know my own stats, so exclusion is explicit.
          const shown = await getRoom(code);
          const excluded = [
            ...(shown?.words ?? []),
            ...(shown?.players.p1?.words ?? []),
          ].map((w) => w.word);
          const myWords = pickBattleWords(
            pool,
            WORDS_PER_BATTLE,
            loadWordStats(),
            excluded
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
    // First game only: rematches start from the rematchRoom transaction once
    // both players press Play again, never from this auto-start.
    if (r.rematchReady?.p1 || r.rematchReady?.p2) return;
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

  // Turn deadline without per-tick renders: the interval only reads refs and
  // submits the timeout once at expiry, so the timer no longer re-renders the
  // whole battle screen 10x/sec (TimerBar animates itself).
  useEffect(() => {
    const r = room;
    if (!r || r.status !== "playing" || r.turnStartedAt == null) return;
    const wordIndex = r.wordIndex;
    const deadline = r.turnStartedAt + TURN_MS;
    const id = window.setInterval(() => {
      if (Date.now() < deadline) return;
      const cur = roomRef.current;
      if (!cur || cur.status !== "playing" || cur.wordIndex !== wordIndex) return;
      const key = slotKey;
      if (!key || !uid) return;
      const my = cur.players[key];
      if (!my || my.lastAnswer?.wordIndex === cur.wordIndex) return;
      if (submittedWordRef.current === cur.wordIndex) return;
      submittedWordRef.current = cur.wordIndex;
      const timedOutWord = cur.words[cur.wordIndex];
      if (timedOutWord) {
        resultsRef.current.push({
          word: timedOutWord.word,
          correct: false,
          ms: TURN_MS,
          timeout: true,
        });
        wordDetailsRef.current.push({
          wordIndex: cur.wordIndex,
          word: timedOutWord.word,
          type: timedOutWord.type,
          correct: false,
        });
      }
      void acting(`timeout-${cur.wordIndex}`, () =>
        submitAnswer(
          cur.code,
          key,
          { wordIndex: cur.wordIndex, answer: "", correct: false, at: Date.now() },
          null,
          0,
          penaltyHit(cur.wordIndex)
        )
      );
    }, 100);
    return () => window.clearInterval(id);
  }, [room, slotKey, uid, acting]);

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
      if (streak > bestStreakRef.current) bestStreakRef.current = streak;

      let hit: Hit | null = null;
      let oppHit: Hit | null = null;
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
      } else {
        oppHit = penaltyHit(r.wordIndex);
      }

      const lastAnswer: LastAnswer = {
        wordIndex: r.wordIndex,
        answer: answer ?? "",
        correct,
        at: Date.now(),
      };
      // Response time + timeout flag drive the 2-option SRS grade in
      // wordProgress: instant (<2s) masters the word, everything else is a
      // retry that keeps it in Pool B for active review.
      resultsRef.current.push({
        word: current.word,
        correct,
        ms: elapsed,
        timeout: answer == null,
      });
      wordDetailsRef.current.push({
        wordIndex: r.wordIndex,
        word: current.word,
        type: current.type,
        correct,
      });

      await submitAnswer(r.code, key, lastAnswer, hit, streak, oppHit).catch((e) => {
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
        if (opp?.hits.some((h) => h.wordIndex === i)) return false;
        if (i === room.wordIndex) {
          return answeredCurrent ? my.lastAnswer!.correct : null;
        }
        return null;
      }),
      selected: answeredCurrent ? my.lastAnswer!.answer : null,
      answerState,
      waitingOpp: answeredCurrent && !oppAnswered && room.status === "playing",
      turnStartedAt: room.status === "playing" ? room.turnStartedAt ?? null : null,
      popups,
      outcome,
    };
  }, [room, slotKey, popups]);

  useEffect(() => {
    if (room?.status === "playing") liveSeenRef.current = true;
  }, [room]);

  useEffect(() => {
    const outcome = view?.outcome;
    if (!outcome || !room || !slotKey) return;
    if (!liveSeenRef.current) return;
    if (recordedRoomRef.current === room.code) return;
    recordedRoomRef.current = room.code;
    const oppKey: SlotKey = slotKey === "p1" ? "p2" : "p1";
    const myHits = room.players[slotKey]?.hits ?? [];
    const oppHits = room.players[oppKey]?.hits ?? [];
    const words: BattleWordDetail[] = wordDetailsRef.current.map((d) => ({
      word: d.word,
      type: d.type,
      pronounceURL: room.words.find((w) => w.word === d.word)?.pronounceURL,
      answer: room.words.find((w) => w.word === d.word)?.correctAnswer,
      correct: d.correct,
      dealt: myHits
        .filter((h) => h.wordIndex === d.wordIndex)
        .reduce((sum, h) => sum + h.damage, 0),
      taken: oppHits
        .filter((h) => h.wordIndex === d.wordIndex)
        .reduce((sum, h) => sum + h.damage, 0),
    }));
    saveBattleSummary({
      outcome,
      mode: "room",
      opponent: room.players[oppKey]?.name ?? undefined,
      roomCode: room.code,
      total: room.words.length,
      answered: words.length,
      correct: words.filter((w) => w.correct).length,
      bestStreak: bestStreakRef.current,
      damageDealt: words.reduce((sum, w) => sum + w.dealt, 0),
      damageTaken: words.reduce((sum, w) => sum + w.taken, 0),
      words,
    });
    recordResult(outcome, room.players[slotKey]?.streak ?? 0).catch((e) =>
      console.error("progress:record", e)
    );
    if (resultsRef.current.length) {
      saveWordResults(resultsRef.current);
      resultsRef.current = [];
    }
  }, [view, room, slotKey]);

  // Player pressed Play again on the result page: the rematch starts as soon
  // as the opponent presses it too — show a waiting screen until then.
  const rematchWaiting =
    room?.status === "ended" && !!slotKey && !!room.rematchReady?.[slotKey];

  return {
    phase: error
      ? "error"
      : needsJoin
        ? "join"
        : !view
          ? "loading"
          : rematchWaiting
            ? "rematch"
            : room!.status,
    error,
    view,
    submit,
    rename,
    join,
    joining,
    isHost,
  } as const;
}

function byHp(hp1: number, hp2: number): "p1" | "p2" | "draw" {
  if (hp1 === hp2) return "draw";
  return hp1 > hp2 ? "p1" : "p2";
}
