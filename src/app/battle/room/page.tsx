"use client";

import { Suspense, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cx } from "@emotion/css";
import { useBattleRoom } from "../../useBattleRoom";
import { BattleScreen } from "../../components/battle/BattleScreen";
import { Card, CardBody } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { describeAuthError } from "../../../lib/firebase";
import { playWordAudio } from "../../playWordAudio";

const NAME_KEY = "battle:name";

const emptySubscribe = () => () => {};

function RoomPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = (searchParams.get("id") ?? "").toUpperCase();
  const name = useSyncExternalStore(
    emptySubscribe,
    () => localStorage.getItem(NAME_KEY) ?? "",
    () => ""
  );

  const { phase, error, view, submit } = useBattleRoom(code, name);

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
          <CardBody className="text-center space-y-3 p-6">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Room code — share it with your friend
            </p>
            <p className="text-5xl font-black font-mono tracking-[0.3em]">
              {code}
            </p>
            <p className="text-xs text-gray-400 break-all">{shareLink}</p>
            <div className="flex flex-col gap-2 pt-1">
              <Button onClick={copyLink}>
                {copied ? "Link copied!" : "Copy invite link"}
              </Button>
              <Button
                onClick={() => router.push("/solo")}
                className="bg-purple-500 border-purple-600 hover:bg-purple-600"
              >
                Play solo while waiting
              </Button>
              <Button
                onClick={() => router.push("/")}
                className="bg-gray-500 border-gray-600 hover:bg-gray-600"
              >
                Leave room
              </Button>
            </div>
          </CardBody>
        </Card>
      </Center>
    );
  }

  return (
    <div className="dark min-h-screen">
      <BattleScreen
        view={view}
        myMaxHp={100}
        oppMaxHp={100}
        allowTimeoutSubmit
        onAnswer={(answer) => submit(answer)}
        onPlayWord={() => playWordAudio(view.word?.pronounce)}
        onExit={() => router.push("/")}
      />
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cx(
        "min-h-screen flex flex-col items-center justify-center p-4",
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
        <div className="flex w-full h-screen items-center justify-center">
          <div className="loader" />
        </div>
      }
    >
      <RoomPage />
    </Suspense>
  );
}
