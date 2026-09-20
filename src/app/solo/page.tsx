"use client";

import { useRouter } from "next/navigation";
import { useSoloBattle } from "../useSoloBattle";
import { BattleScreen } from "../components/battle/BattleScreen";
import { Button } from "../components/ui/Button";
import { playWordAudio } from "../playWordAudio";
import { SOLO_BOSS, MAX_HP } from "../../lib/gameConfig";

export default function SoloPage() {
  const router = useRouter();
  const { phase, error, view, submit, reset } = useSoloBattle();

  if (phase === "loading") {
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
        oppMaxHp={SOLO_BOSS.hp}
        allowTimeoutSubmit={false}
        onAnswer={submit}
        onPlayWord={() => playWordAudio(view.word?.pronounce)}
        onExit={() => router.push("/")}
        onRematch={reset}
      />
    </div>
  );
}
