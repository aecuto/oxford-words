"use client";

import { Suspense, useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cx } from "@emotion/css";
import { useRoomBattleStore } from "../../stores/roomBattleStore";
import { useNameStore } from "../../stores/nameStore";
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
  const name = useNameStore((s) => s.name);
  const { phase, error, view, isHost, room } = useRoomBattleStore();

  const submit = useCallback((answer: string | null) => {
    void useRoomBattleStore.getState().submitPlayer(answer);
  }, []);
  const join = useCallback((joinName: string) => {
    void useRoomBattleStore.getState().join(joinName);
  }, []);

  useEffect(() => {
    useNameStore.getState().sync();
  }, []);

  useEffect(() => {
    useRoomBattleStore.getState().connect(code);
    return () => useRoomBattleStore.getState().disconnect();
  }, [code]);

  useEffect(() => {
    useRoomBattleStore.getState().maybeAutoStart();
  }, [room]);

  useEffect(() => {
    useRoomBattleStore.getState().settleTurn();
  }, [room]);

  // Turn deadline without per-tick renders: the interval only reads the
  // store and submits the timeout once at expiry, so the timer never
  // re-renders the whole battle screen (TimerBar animates itself).
  useEffect(() => {
    const id = window.setInterval(
      () => useRoomBattleStore.getState().deadlineTick(),
      100
    );
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (room?.status === "ended") {
      useRoomBattleStore.getState().recordOutcome();
    }
  }, [room]);

  const autoJoinedRef = useRef(false);
  useEffect(() => {
    if (phase !== "join" || autoJoinedRef.current) return;
    autoJoinedRef.current = true;
    join(name);
  }, [phase, join, name]);

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
        <div className="loader" />
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
    if (isHost) {
      return <BackToLobby />;
    }
    return (
      <Center>
        <div className="loader" />
        <p className="mt-4 text-sm text-gray-400">
          Waiting for the host to start...
        </p>
        <Button
          onClick={() => router.push("/")}
          variant="gray"
          className="mt-4"
        >
          Back to lobby
        </Button>
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
        onPlayWord={() => playWordAudio(view.word?.pronounceURL)}
        onExit={() => router.push("/")}
        onViewResult={() =>
          router.push(`/result?outcome=${view.outcome}&mode=room`)
        }
      />
    </div>
  );
}

function BackToLobby() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/");
  }, [router]);
  return (
    <Center>
      <div className="loader" />
    </Center>
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
