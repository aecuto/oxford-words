"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardBody } from "./components/ui/Card";
import { Button } from "./components/ui/Button";
import { ProgressPanel } from "./components/ProgressPanel";
import { useStoredName } from "./useStoredName";
import {
  pickBattleWords,
  loadWordPool,
  mergeWordLists,
} from "../game/wordPool";
import { loadWordStats } from "../game/wordProgress";
import {
  closeRoom,
  createRoom,
  pingRoom,
  renamePlayer,
  subscribeOpenRooms,
  subscribeRoom,
  startGame,
} from "../game/roomService";
import { WORDS_PER_BATTLE } from "../lib/gameConfig";
import { describeAuthError, ensureAnonAuth } from "../lib/firebase";
import type { ClientRoom, OpenRoom } from "../game/types";

const emptySubscribe = () => () => {};

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
  const startingRef = useRef(false);

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
        <div className="text-center mb-4">
          <p className="text-xs sm:text-sm font-black uppercase tracking-[0.3em] text-gray-500">
            BATTLE
          </p>
          <h1 className="text-4xl sm:text-5xl font-black tracking-wide leading-none mt-1.5 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent select-none">
            Oxford Words
          </h1>
        </div>

        <ProgressPanel />

        <div className="grid grid-cols-1 md:grid-cols-2 items-stretch gap-3 sm:gap-4 lg:gap-5">
          <Card className="border-2 border-blue-500/40">
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
                <div className="rounded-lg bg-blue-500/10 border border-blue-500/40 px-3 py-2.5 flex items-center justify-between gap-2">
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
                className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-600 text-base text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                                ? "w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-blue-500/10 border-2 border-blue-500 text-left cursor-default"
                                : "w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-600 hover:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors text-left"
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

          <Card className="border-2 border-purple-500/40">
            <CardBody className="p-4 sm:p-5 lg:p-6 flex flex-col h-full">
              <div>
                <h2 className="text-xl sm:text-2xl font-black text-purple-400">
                  VS BOT
                </h2>
                <p className="text-xs text-gray-400 mt-1">
                  Fight the BOT solo. Works fully offline, no account needed.
                </p>
              </div>

              <div className="flex-1" />

              <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                <div className="flex flex-col gap-1.5">
                  <Link href="/solo?difficulty=easy" className="block">
                    <Button
                      variant="blue"
                      className="w-full sm:text-lg sm:py-3.5"
                    >
                      Easy
                    </Button>
                  </Link>
                  <p className="text-[10px] sm:text-xs text-gray-500 text-center leading-snug">
                    BOT · relaxed, answers most words
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Link href="/solo?difficulty=hard" className="block">
                    <Button
                      variant="purple"
                      className="w-full sm:text-lg sm:py-3.5"
                    >
                      Hard
                    </Button>
                  </Link>
                  <p className="text-[10px] sm:text-xs text-gray-500 text-center leading-snug">
                    PROF · fast, hard hits, streak crits
                  </p>
                </div>
              </div>
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
