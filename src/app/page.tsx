"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardBody } from "./components/ui/Card";
import { Button } from "./components/ui/Button";
import { ProgressPanel } from "./components/ProgressPanel";
import { pickBattleWords, loadWordPool } from "../game/wordPool";
import { loadWordStats } from "../game/wordProgress";
import { createRoom } from "../game/roomService";
import { WORDS_PER_BATTLE } from "../lib/gameConfig";
import { describeAuthError, ensureAnonAuth } from "../lib/firebase";

const NAME_KEY = "battle:name";

const emptySubscribe = () => () => {};

export default function BattleHub() {
  const router = useRouter();
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const storedName = useSyncExternalStore(
    emptySubscribe,
    () => localStorage.getItem(NAME_KEY) ?? "",
    () => ""
  );
  const name = nameOverride ?? storedName;
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

  const saveName = (value: string) => {
    setNameOverride(value);
    localStorage.setItem(NAME_KEY, value);
  };

  const create = async () => {
    setError(null);
    setBusy("create");
    try {
      const uid = await ensureAnonAuth();
      const pool = await loadWordPool();
      const words = pickBattleWords(
        pool,
        WORDS_PER_BATTLE,
        loadWordStats()
      );
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
    <div className="dark min-h-dvh pt-safe pb-safe">
      <div className="px-3 sm:p-6 m-auto w-full max-w-screen-md">
        <h1 className="text-3xl sm:text-4xl font-black text-center mt-6 sm:mt-8 mb-1 tracking-wide">
          BATTLE
        </h1>
        <p className="text-center text-sm text-gray-400 mb-5 sm:mb-6 max-w-md m-auto">
          Same word for both fighters. Answer fast, hit hard, chain 3 for a
          CRITICAL.
        </p>

        <ProgressPanel />

        <div className="grid md:grid-cols-2 gap-3 sm:gap-4">
          <Card className="border-2 border-blue-500/40">
            <CardBody className="p-4 sm:p-5 space-y-4">
              <div>
                <h2 className="text-xl sm:text-2xl font-black text-blue-400">
                  VS PLAYER
                </h2>
                <p className="text-xs text-gray-400 mt-1">
                  Create a room, send the code, race in real time.
                </p>
              </div>

              <input
                value={name}
                onChange={(e) => saveName(e.target.value)}
                maxLength={16}
                placeholder="Your name"
                className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-600 text-base text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              <Button
                onClick={create}
                disabled={busy !== null}
                className="w-full lg:text-lg lg:py-3"
              >
                {busy === "create" ? "Creating room..." : "Create room"}
              </Button>

              <div className="flex items-center gap-2 pt-1">
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  maxLength={4}
                  placeholder="CODE"
                  className="flex-1 min-w-0 px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-600 font-mono font-bold text-lg tracking-widest uppercase text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <Button
                  onClick={join}
                  disabled={busy !== null}
                  className="bg-blue-500 border-blue-600 hover:bg-blue-600 shrink-0"
                >
                  {busy === "join" ? "..." : "Join"}
                </Button>
              </div>
            </CardBody>
          </Card>

          <Card className="border-2 border-purple-500/40">
            <CardBody className="p-4 sm:p-5 flex flex-col h-full">
              <div>
                <h2 className="text-xl sm:text-2xl font-black text-purple-400">
                  VS BOT
                </h2>
                <p className="text-xs text-gray-400 mt-1">
                  Fight the BOT solo. Works fully offline, no account needed.
                </p>
              </div>

              <div className="flex-1 flex items-center justify-center py-6 sm:py-8">
                <span className="text-4xl sm:text-5xl font-black text-gray-700 dark:text-gray-700 select-none tracking-widest">
                  HP 300
                </span>
              </div>

              <Link href="/solo" className="mt-auto">
                <Button className="w-full lg:text-lg lg:py-3 bg-purple-500 border-purple-600 hover:bg-purple-600">
                  Play
                </Button>
              </Link>
            </CardBody>
          </Card>
        </div>

        {error && (
          <p className="text-sm text-red-400 text-center mt-4 max-w-screen-sm m-auto">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
