"use client";

import { Suspense, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cx } from "@emotion/css";
import { Button } from "../components/ui/Button";

const RESULT_TEXT = {
  win: { title: "VICTORY", color: "text-emerald-500" },
  lose: { title: "DEFEAT", color: "text-red-500" },
  draw: { title: "DRAW", color: "text-amber-500" },
} as const;

const MODE_DETAIL = {
  solo: "Solo battle vs BOT",
  room: "Online battle",
} as const;

type Outcome = keyof typeof RESULT_TEXT;
type Mode = keyof typeof MODE_DETAIL;

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="dark min-h-dvh flex flex-col items-center justify-center p-4">
      {children}
    </div>
  );
}

function parseOutcome(param: string | null): Outcome | null {
  return param && param in RESULT_TEXT ? (param as Outcome) : null;
}

function parseMode(param: string | null): Mode | null {
  return param && param in MODE_DETAIL ? (param as Mode) : null;
}

function ResultPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const outcome = parseOutcome(searchParams.get("outcome"));
  const mode = parseMode(searchParams.get("mode"));

  const playAgain = () => router.push("/solo");
  const backToLobby = () => router.push("/");

  if (!outcome) {
    return (
      <Shell>
        <Button onClick={backToLobby}>Back to lobby</Button>
      </Shell>
    );
  }

  const result = RESULT_TEXT[outcome];

  return (
    <Shell>
      <div className="flex flex-col items-center animate-popIn">
        <p className="text-xs sm:text-sm font-black uppercase tracking-[0.3em] text-gray-500">
          Battle over
        </p>
        <h1
          className={cx(
            "text-6xl sm:text-8xl font-black tracking-widest mt-2 select-none",
            result.color
          )}
        >
          {result.title}
        </h1>
        {mode && (
          <p className="text-xs sm:text-sm uppercase tracking-widest text-gray-400 mt-4">
            {MODE_DETAIL[mode]}
          </p>
        )}
        <div className="flex flex-col gap-3 w-full max-w-xs mt-10 sm:mt-12">
          {mode === "solo" && (
            <Button onClick={playAgain} className="sm:text-lg sm:py-3.5">
              Play again
            </Button>
          )}
          <Button
            onClick={backToLobby}
            variant="gray"
            className="sm:text-lg sm:py-3.5"
          >
            Back to lobby
          </Button>
        </div>
      </div>
    </Shell>
  );
}

export default function Result() {
  return (
    <Suspense
      fallback={
        <div className="flex w-full min-h-dvh items-center justify-center">
          <div className="loader" />
        </div>
      }
    >
      <ResultPage />
    </Suspense>
  );
}
