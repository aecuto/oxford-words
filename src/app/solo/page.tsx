"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useSoloBattle } from "../useSoloBattle";
import { BattleScreen } from "../components/battle/BattleScreen";
import { Button } from "../components/ui/Button";
import { playWordAudio } from "../playWordAudio";
import {
  MAX_HP,
  botConfigFor,
  type SoloDifficulty,
} from "../../lib/gameConfig";

// Deep link ?difficulty=easy|hard (lobby VS BOT buttons) picks the bot.
function parseDifficulty(param: string | null): SoloDifficulty | null {
  return param === "easy" || param === "hard" ? param : null;
}

export default function SoloPage() {
  return (
    <Suspense
      fallback={
        <div className="dark flex w-full min-h-dvh items-center justify-center">
          <div className="loader" />
        </div>
      }
    >
      <SoloPageInner />
    </Suspense>
  );
}

function SoloPageInner() {
  const searchParams = useSearchParams();
  // No ?difficulty= (bare /solo) defaults to the easy bot.
  const difficulty = parseDifficulty(searchParams.get("difficulty")) ?? "easy";

  return <SoloGame difficulty={difficulty} />;
}

function SoloGame({ difficulty }: { difficulty: SoloDifficulty }) {
  const router = useRouter();
  const bot = botConfigFor(difficulty);
  const { phase, error, view, submit } = useSoloBattle(difficulty);

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
        oppMaxHp={bot.hp}
        onAnswer={submit}
        onPlayWord={() => playWordAudio(view.word?.pronounce)}
        onExit={() => router.push("/")}
        onViewResult={() =>
          router.push(
            `/result?outcome=${view.outcome}&mode=solo&difficulty=${difficulty}`
          )
        }
      />
    </div>
  );
}
