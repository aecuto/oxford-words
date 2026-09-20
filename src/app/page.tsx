"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardBody } from "./components/ui/Card";
import { Button } from "./components/ui/Button";
import { ProgressPanel } from "./components/ProgressPanel";
import { useStoredName } from "./useStoredName";
import { pickBattleWords, loadWordPool } from "../game/wordPool";
import { loadWordStats } from "../game/wordProgress";
import { createRoom } from "../game/roomService";
import { WORDS_PER_BATTLE } from "../lib/gameConfig";
import { describeAuthError, ensureAnonAuth } from "../lib/firebase";

const emptySubscribe = () => () => {};

export default function BattleHub() {
  const router = useRouter();
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const { name } = useStoredName();
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      router.push(`/battle/room?id=${code}`);
    } catch (e) {
      console.error(e);
      setError(describeAuthError(e));
      setBusy(null);
    }
  };

  const join = async () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) {
      setError("Enter the 4-character room code.");
      return;
    }
    setError(null);
    setBusy("join");
    try {
      await ensureAnonAuth();
      router.push(`/battle/room?id=${code}`);
    } catch (e) {
      console.error(e);
      setError(describeAuthError(e));
      setBusy(null);
    }
  };

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
                  Create a room, send the code, race in real time.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:gap-3.5">
                <Button
                  onClick={create}
                  disabled={busy !== null}
                  className="w-full sm:text-lg sm:py-3.5"
                >
                  {busy === "create" ? "Creating room..." : "Create room"}
                </Button>

                <div className="flex items-stretch gap-2">
                  <input
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    maxLength={4}
                    inputMode="text"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="CODE"
                    className="flex-1 min-w-0 px-3 py-2.5 sm:py-3 rounded-lg bg-gray-800 border border-gray-600 font-mono font-bold text-base sm:text-lg tracking-widest uppercase text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <Button
                    onClick={join}
                    disabled={busy !== null}
                    variant="blue"
                    className="shrink-0 min-h-[3rem] sm:min-h-0"
                  >
                    {busy === "join" ? "..." : "Join"}
                  </Button>
                </div>
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

              <div className="flex-1 flex items-center justify-center py-4 sm:py-8">
                <span className="text-3xl sm:text-5xl font-black text-gray-700 dark:text-gray-700 select-none tracking-widest">
                  HP 300
                </span>
              </div>

              <Link href="/solo" className="mt-auto">
                <Button
                  variant="purple"
                  className="w-full sm:text-lg sm:py-3.5"
                >
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
