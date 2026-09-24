"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useSoloBattle } from "../useSoloBattle";
import { BattleScreen } from "../components/battle/BattleScreen";
import { Button } from "../components/ui/Button";
import { Card, CardBody } from "../components/ui/Card";
import { playWordAudio } from "../playWordAudio";
import {
  MAX_HP,
  botConfigFor,
  type SoloDifficulty,
} from "../../lib/gameConfig";

// Deep link ?difficulty=easy|hard (lobby VS BOT buttons) skips the picker.
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [difficulty, setDifficulty] = useState<SoloDifficulty | null>(() =>
    parseDifficulty(searchParams.get("difficulty"))
  );

  if (!difficulty) {
    return (
      <div className="dark min-h-dvh flex flex-col items-center justify-center p-4 pt-safe pb-safe">
        <h1 className="text-2xl font-black mb-1">Solo battle</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Choose your opponent
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-md">
          <Card
            onClick={() => setDifficulty("easy")}
            className="cursor-pointer ring-1 ring-transparent hover:ring-2 hover:ring-blue-400 active:scale-[0.98] transition-all"
          >
            <CardBody className="text-center py-6">
              <p className="text-2xl font-black mb-1">BOT</p>
              <p className="text-xs font-bold uppercase tracking-wide text-blue-600 dark:text-blue-400 mb-2">
                Easy
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                Answers most words like a real player with steady hits. Its
                misses cost it nothing — out-damage it to win.
              </p>
            </CardBody>
          </Card>
          <Card
            onClick={() => setDifficulty("hard")}
            className="cursor-pointer ring-1 ring-transparent hover:ring-2 hover:ring-red-400 active:scale-[0.98] transition-all"
          >
            <CardBody className="text-center py-6">
              <p className="text-2xl font-black mb-1">PROF</p>
              <p className="text-xs font-bold uppercase tracking-wide text-red-600 dark:text-red-400 mb-2">
                Hard
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                Answers almost every word, fast, and every hit lands hard with
                streak crits. Extra HP — out-race it to the KO.
              </p>
            </CardBody>
          </Card>
        </div>
        <Button variant="gray" className="mt-8" onClick={() => router.push("/")}>
          Back to lobby
        </Button>
      </div>
    );
  }

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
