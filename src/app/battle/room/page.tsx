"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cx } from "@emotion/css";
import { useBattleRoom } from "../../useBattleRoom";
import { useStoredName } from "../../useStoredName";
import { BattleScreen } from "../../components/battle/BattleScreen";
import { Card, CardBody } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { MAX_HP } from "../../../lib/gameConfig";
import { describeAuthError } from "../../../lib/firebase";
import { playWordAudio } from "../../playWordAudio";

function RoomPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = (searchParams.get("id") ?? "").toUpperCase();
  const { name, saveName } = useStoredName();

  const { phase, error, view, submit, rename, join, joining } =
    useBattleRoom(code);

  const [copied, setCopied] = useState(false);
  const shareLink =
    typeof window !== "undefined" && code
      ? `${window.location.origin}/battle/room?id=${code}`
      : "";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      console.error("clipboard failed");
    }
  };

  if (!code) {
    return (
      <Center>
        <p className="mb-4">Missing room code.</p>
        <Button onClick={() => router.push("/")}>Back to lobby</Button>
      </Center>
    );
  }

  if (error) {
    return (
      <Center>
        <p className="text-red-500 text-sm mb-4">{error}</p>
        <Button onClick={() => router.push("/")}>Back to lobby</Button>
      </Center>
    );
  }

  if (phase === "join") {
    return (
      <Center>
        <Card className="w-full max-w-sm animate-popIn">
          <CardBody className="text-center space-y-3 p-5 sm:p-6">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Joining room
            </p>
            <p className="text-4xl sm:text-5xl font-black font-mono tracking-[0.2em] sm:tracking-[0.3em]">
              {code}
            </p>
            <input
              value={name}
              maxLength={16}
              placeholder="Player 2"
              onChange={(e) => saveName(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-600 text-base text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex flex-col gap-2 pt-1">
              <Button onClick={() => join(name)} disabled={joining}>
                {joining ? "Joining..." : "Join"}
              </Button>
              <Button onClick={() => router.push("/")} variant="gray">
                Cancel
              </Button>
            </div>
          </CardBody>
        </Card>
      </Center>
    );
  }

  if (phase === "loading" || !view) {
    return (
      <Center>
        <div className="loader" />
        <p className="mt-4 text-sm text-gray-400">Entering room {code}...</p>
      </Center>
    );
  }

  if (phase === "waiting") {
    return (
      <Center>
        <Card className="w-full max-w-sm animate-popIn">
          <CardBody className="text-center space-y-3 p-5 sm:p-6">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Room code — share it with your friend
            </p>
            <p className="text-4xl sm:text-5xl font-black font-mono tracking-[0.2em] sm:tracking-[0.3em]">
              {code}
            </p>
            <p className="text-xs text-gray-400 break-all">{shareLink}</p>
            <div className="pt-1 text-left">
              <label
                htmlFor="room-name"
                className="text-xs font-bold text-gray-400 uppercase tracking-wide"
              >
                Your name
              </label>
              <input
                id="room-name"
                value={name}
                maxLength={16}
                placeholder="Your name"
                onChange={(e) => {
                  saveName(e.target.value);
                  rename(e.target.value);
                }}
                className="mt-1 w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-600 text-base text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex flex-col gap-2 pt-1">
              <Button onClick={copyLink}>
                {copied ? "Link copied!" : "Copy invite link"}
              </Button>
              <Button onClick={() => router.push("/solo")} variant="purple">
                Play solo while waiting
              </Button>
              <Button onClick={() => router.push("/")} variant="gray">
                Leave room
              </Button>
            </div>
          </CardBody>
        </Card>
      </Center>
    );
  }

  if (phase === "rematch") {
    return (
      <Center>
        <Card className="w-full max-w-sm animate-popIn">
          <CardBody className="text-center space-y-3 p-5 sm:p-6">
            <p className="text-sm font-black uppercase tracking-widest text-gray-500">
              Rematch
            </p>
            <p className="text-2xl sm:text-3xl font-black">You are ready!</p>
            <p className="text-sm text-gray-400">
              Waiting for your opponent to press Play again...
            </p>
            <div className="flex items-center justify-center gap-1.5 pt-1" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-2 w-2 rounded-full bg-blue-400 animate-bounce"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </div>
            <div className="flex flex-col gap-2 pt-1">
              <Button onClick={() => router.push("/")} variant="gray">
                Leave room
              </Button>
            </div>
          </CardBody>
        </Card>
      </Center>
    );
  }

  return (
    <div className="dark min-h-dvh pt-safe pb-safe">
      <BattleScreen
        view={view}
        myMaxHp={MAX_HP}
        oppMaxHp={MAX_HP}
        onAnswer={submit}
        onPlayWord={() => playWordAudio(view.word?.pronounce)}
        onExit={() => router.push("/")}
        onViewResult={() =>
          router.push(`/result?outcome=${view.outcome}&mode=room`)
        }
      />
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cx(
        "min-h-dvh flex flex-col items-center justify-center p-4",
        "dark"
      )}
    >
      {children}
    </div>
  );
}

export default function BattleRoom() {
  return (
    <Suspense
      fallback={
        <div className="flex w-full min-h-dvh items-center justify-center">
          <div className="loader" />
        </div>
      }
    >
      <RoomPage />
    </Suspense>
  );
}
