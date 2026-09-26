"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSoloBattleStore } from "../stores/soloBattleStore";
import { BattleScreen } from "../components/battle/BattleScreen";
import { Button } from "../components/ui/Button";
import { playWordAudio } from "../playWordAudio";
import { MAX_HP } from "../../lib/gameConfig";
import { SOLO_BOT } from "../../game/botBrain";

export default function SoloPage() {
  const router = useRouter();
  const bot = SOLO_BOT;
  const { phase, error, view, outcome } = useSoloBattleStore();

  // Mount/unmount drive the store's pool loading and bot clock.
  useEffect(() => {
    useSoloBattleStore.getState().mount();
    return () => useSoloBattleStore.getState().unmount();
  }, []);

  // Turn deadline: the interval only reads the store and fires the timeout
  // once at expiry, so it never re-renders per tick (TimerBar animates).
  useEffect(() => {
    const id = window.setInterval(
      () => useSoloBattleStore.getState().tick(),
      100
    );
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (outcome) useSoloBattleStore.getState().recordOutcome();
  }, [outcome]);

  const submit = (answer: string | null) =>
    useSoloBattleStore.getState().submitPlayer(answer);

  if (phase === "loading" || !view) {
    return (
      <div className="dark min-h-dvh">
        <div className="flex w-full min-h-dvh items-center justify-center">
          <div className="loader" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dark min-h-dvh flex flex-col items-center justify-center p-4">
        <p className="text-red-400 text-sm mb-4">{error}</p>
        <Button onClick={() => router.push("/")}>Back to lobby</Button>
      </div>
    );
  }

  return (
    <div className="dark min-h-dvh pt-safe pb-safe">
      <BattleScreen
        view={view}
        myMaxHp={MAX_HP}
        oppMaxHp={bot.hp}
        onAnswer={submit}
        onPlayWord={() => playWordAudio(view.word?.pronounceURL)}
        onExit={() => router.push("/")}
        onViewResult={() =>
          router.push(`/result?outcome=${view.outcome}&mode=solo`)
        }
      />
    </div>
  );
}
