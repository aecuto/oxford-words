"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardBody } from "./components/ui/Card";
import { Button } from "./components/ui/Button";
import { Logo } from "./components/Logo";
import { ProgressPanel } from "./components/ProgressPanel";
import { WordLevelSelect } from "./components/WordLevelSelect";
import { useStoredName } from "./useStoredName";
import {
  pickBattleWords,
  loadWordPool,
  mergeWordLists,
} from "../game/wordPool";
import { loadWordStats } from "../game/wordProgress";
import { loadWordLevel, saveWordLevel } from "../game/wordLevel";
import { loadBattleSummary } from "../game/battleSummary";
import {
  closeRoom,
  createRoom,
  pingRoom,
  renamePlayer,
  subscribeOpenRooms,
  subscribeRoom,
  startGame,
} from "../game/roomService";
import {
  SOLO_BOT,
  TURN_MS,
  WORDS_PER_BATTLE,
  type WordLevel,
} from "../lib/gameConfig";
import { describeAuthError, ensureAnonAuth } from "../lib/firebase";
import type { ClientRoom, OpenRoom } from "../game/types";

const emptySubscribe = () => () => {};

// Tiny CSS-only robot head for the VS BOT card — no image, no emoji.
function BotFace() {
  return (
    <div className="shrink-0 relative w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-purple-500/10 border border-purple-500/30">
      <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-1 h-1.5 rounded-full bg-purple-500/60" />
      <span className="absolute inset-x-0 top-[30%] flex justify-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
        <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
      </span>
      <span className="absolute left-1/2 -translate-x-1/2 bottom-[22%] w-4 h-0.5 rounded-full bg-purple-400/70" />
    </div>
  );
}

export default function BattleHub() {
  const router = useRouter();
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const { name, saveName } = useStoredName();
  const [busy, setBusy] = useState<"create" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openRooms, setOpenRooms] = useState<OpenRoom[] | null>(null);
  const [myUid, setMyUid] = useState<string | null>(null);
  const [myRoomCode, setMyRoomCode] = useState<string | null>(null);
  const [myRoom, setMyRoom] = useState<ClientRoom | null>(null);
  // Last solo result from sessionStorage — a personal hook to replay the bot.
  const [lastSolo, setLastSolo] = useState<
    { outcome: "win" | "lose" | "draw"; correct: number; answered: number } | null
  >(null);
  // Active word list (3000/5000). Read after mount like lastSolo so the
  // hydrated render matches SSR; the level flows into ProgressPanel as a
  // prop so only the pool totals refresh — progress stats never reload.
  const [wordLevel, setWordLevel] = useState<WordLevel>("3000");
  const startingRef = useRef(false);

  useEffect(() => {
    const s = loadBattleSummary();
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot: read session storage + the stored word level after mount to avoid SSR/hydration mismatch */
    setLastSolo(
      s && s.mode === "solo"
        ? { outcome: s.outcome, correct: s.correct, answered: s.answered }
        : null,
    );
    setWordLevel(loadWordLevel());
  }, []);

  const changeWordLevel = (level: WordLevel) => {
    setWordLevel(level);
    saveWordLevel(level);
  };

  useEffect(() => {
    let alive = true;
    let unsub: (() => void) | null = null;
    (async () => {
      try {
        const uid = await ensureAnonAuth();
        if (!alive) return;
        setMyUid(uid);
        unsub = subscribeOpenRooms(setOpenRooms);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      alive = false;
      unsub?.();
    };
  }, []);

  useEffect(() => {
    if (!myRoomCode) return;
    let alive = true;
    const unsub = subscribeRoom(myRoomCode, (r) => {
      if (!alive) return;
      setMyRoom(r);
      if (
        r &&
        r.status === "waiting" &&
        r.players.p2 != null &&
        !startingRef.current
      ) {
        startingRef.current = true;
        const merged = mergeWordLists(
          r.words,
          r.players.p2.words ?? [],
          r.words.length || WORDS_PER_BATTLE,
        );
        startGame(r.code, merged).catch((e) => {
          startingRef.current = false;
          console.error(e);
        });
      }
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [myRoomCode]);

  useEffect(() => {
    if (!myRoomCode) return;
    const ping = () => pingRoom(myRoomCode).catch((e) => console.error(e));
    ping();
    const id = window.setInterval(ping, 30000);
    return () => window.clearInterval(id);
  }, [myRoomCode]);

  useEffect(() => {
    if (myRoom?.status === "playing") {
      router.push(`/battle/room?id=${myRoom.code}`);
    }
  }, [myRoom, router]);

  if (!isClient) {
    return (
      <div className="dark">
        <div className="flex w-full min-h-dvh items-center justify-center">
          <div className="loader" />
        </div>
      </div>
    );
  }

  const create = async () => {
    setError(null);
    setBusy("create");
    try {
      const uid = await ensureAnonAuth();
      const pool = await loadWordPool();
      const words = pickBattleWords(pool, WORDS_PER_BATTLE, loadWordStats());
      const code = await createRoom(uid, name.trim() || "Player 1", words);
      startingRef.current = false;
      setMyRoom(null);
      setMyRoomCode(code);
    } catch (e) {
      console.error(e);
      setError(describeAuthError(e));
    } finally {
      setBusy(null);
    }
  };

  const cancelRoom = () => {
    if (myRoomCode) {
      closeRoom(myRoomCode).catch((e) => console.error(e));
    }
    startingRef.current = false;
    setMyRoomCode(null);
    setMyRoom(null);
  };

  const visibleRooms = (openRooms ?? []).filter(
    (room) => room.hostUid !== myUid || room.code === myRoomCode,
  );

  return (
    <div className="dark min-h-dvh pt-safe pb-safe flex flex-col">
      <div className="px-3 sm:px-6 m-auto w-full max-w-screen-md pt-6 sm:pt-10 pb-8 sm:pb-12">
        <Logo className="mb-4" />

        <ProgressPanel level={wordLevel} />

        <div className="mb-3 sm:mb-4">
          <WordLevelSelect value={wordLevel} onChange={changeWordLevel} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 items-stretch gap-3 sm:gap-4 lg:gap-5">
          <Card className="border border-gray-800">
            <CardBody className="p-4 sm:p-5 lg:p-6 space-y-3.5 sm:space-y-4">
              <div>
                <h2 className="text-xl sm:text-2xl font-black text-blue-400">
                  VS PLAYER
                </h2>
                <p className="text-xs text-gray-400 mt-1">
                  Create a room — it appears in the list below, anyone can join
                  with one tap.
                </p>
              </div>

              {myRoomCode ? (
                <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 px-3 py-2.5 flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-lg font-black font-mono tracking-[0.2em] text-blue-400">
                    {myRoomCode}
                  </p>
                  <Button
                    variant="gray"
                    onClick={cancelRoom}
                    className="shrink-0 px-3 py-2 text-xs"
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  onClick={create}
                  disabled={busy !== null}
                  className="w-full sm:text-lg sm:py-3.5"
                >
                  {busy === "create" ? "Creating room..." : "Create room"}
                </Button>
              )}

              <input
                value={name}
                maxLength={16}
                placeholder="Your name"
                aria-label="Your name"
                onChange={(e) => {
                  saveName(e.target.value);
                  if (myRoom && myRoom.hostUid === myUid) {
                    renamePlayer(myRoom.code, "p1", e.target.value).catch(
                      (err) => console.error(err),
                    );
                  }
                }}
                className="w-full px-3 py-2.5 rounded-lg bg-gray-800/60 border border-gray-700 text-base text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
              />

              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
                  Open rooms
                </p>
                {openRooms === null ? (
                  <p className="text-xs text-gray-500">Loading rooms...</p>
                ) : visibleRooms.length === 0 ? (
                  <p className="text-xs text-gray-500">
                    No open rooms right now — create one and it shows up here
                    for everyone.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {visibleRooms.map((room) => {
                      const mine = room.hostUid === myUid;
                      return (
                        <li key={room.code}>
                          <button
                            onClick={() =>
                              !mine &&
                              router.push(`/battle/room?id=${room.code}`)
                            }
                            disabled={
                              busy !== null || (!mine && myRoomCode !== null)
                            }
                            className={
                              mine
                                ? "w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-blue-500/10 border border-blue-500 text-left cursor-default"
                                : "w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-gray-800/60 border border-gray-700 hover:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors text-left"
                            }
                          >
                            <span className="min-w-0">
                              <span
                                className={
                                  mine
                                    ? "block text-sm font-bold text-blue-400 truncate"
                                    : "block text-sm font-bold text-white truncate"
                                }
                              >
                                {mine ? "Your room" : room.host}
                              </span>
                              <span className="block text-[10px] text-gray-500">
                                waiting
                              </span>
                            </span>
                            <span className="shrink-0 text-xs font-black uppercase tracking-wide text-blue-400">
                              {mine ? "You →" : "Join →"}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </CardBody>
          </Card>

          <Card className="border border-gray-800">
            <CardBody className="p-4 sm:p-5 lg:p-6 flex flex-col h-full">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl sm:text-2xl font-black text-purple-400">
                    VS BOT
                  </h2>
                  <p className="text-xs text-gray-400 mt-1">
                    Fast {WORDS_PER_BATTLE}-word run — no account needed,
                    works fully offline.
                  </p>
                </div>
                <BotFace />
              </div>

              {/* Live bot profile — pulled from SOLO_BOT so it can't drift */}
              <div className="grid grid-cols-3 gap-2 mt-4">
                <div className="rounded-lg bg-gray-800/60 px-2 py-2 text-center">
                  <p className="text-base sm:text-lg font-black text-purple-400 leading-tight">
                    {SOLO_BOT.hp}
                  </p>
                  <p className="text-[10px] uppercase tracking-wide text-gray-500">
                    bot hp
                  </p>
                </div>
                <div className="rounded-lg bg-gray-800/60 px-2 py-2 text-center">
                  <p className="text-base sm:text-lg font-black text-purple-400 leading-tight">
                    {Math.round(SOLO_BOT.accuracy * 100)}%
                  </p>
                  <p className="text-[10px] uppercase tracking-wide text-gray-500">
                    accuracy
                  </p>
                </div>
                <div className="rounded-lg bg-gray-800/60 px-2 py-2 text-center">
                  <p className="text-base sm:text-lg font-black text-purple-400 leading-tight">
                    {TURN_MS / 1000}s
                  </p>
                  <p className="text-[10px] uppercase tracking-wide text-gray-500">
                    per word
                  </p>
                </div>
              </div>

              {lastSolo && (
                <p className="mt-3 text-xs text-gray-500">
                  Last run:{" "}
                  <span
                    className={
                      lastSolo.outcome === "win"
                        ? "font-black text-green-400"
                        : lastSolo.outcome === "lose"
                          ? "font-black text-red-400"
                          : "font-black text-yellow-400"
                    }
                  >
                    {lastSolo.outcome.toUpperCase()}
                  </span>{" "}
                  · {lastSolo.correct}/{lastSolo.answered} correct
                </p>
              )}

              <div className="flex-1" />

              <Link href="/solo" className="block">
                <Button variant="purple" className="w-full sm:text-lg sm:py-3.5">
                  Play
                </Button>
              </Link>
            </CardBody>
          </Card>
        </div>

        {error && (
          <p className="text-sm text-red-400 text-center mt-4 max-w-screen-sm m-auto px-2 break-words">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
