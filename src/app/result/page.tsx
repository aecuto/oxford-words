"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cx } from "@emotion/css";
import { SpeakerWaveIcon } from "@heroicons/react/24/solid";
import { Button } from "../components/ui/Button";
import { Card, CardBody } from "../components/ui/Card";
import { playWordAudio } from "../playWordAudio";
import { useStoredName } from "../useStoredName";
import {
  loadBattleSummary,
  type BattleSummary,
} from "../../game/battleSummary";
import { rematchRoom } from "../../game/roomService";
import { loadWordPool, pickBattleWords } from "../../game/wordPool";
import { loadWordStats } from "../../game/wordProgress";
import { WORDS_PER_BATTLE } from "../../lib/gameConfig";
import { describeAuthError, ensureAnonAuth } from "../../lib/firebase";

const RESULT_TEXT = {
  win: { title: "VICTORY", color: "text-emerald-500" },
  lose: { title: "DEFEAT", color: "text-red-500" },
  draw: { title: "DRAW", color: "text-amber-500" },
} as const;

type Outcome = keyof typeof RESULT_TEXT;
type Mode = "solo" | "room";

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="dark min-h-dvh flex flex-col items-center justify-center p-4">
      {children}
    </div>
  );
}

function parseOutcome(param: string | null): Outcome | null {
  return param === "win" || param === "lose" || param === "draw"
    ? param
    : null;
}

function parseMode(param: string | null): Mode | null {
  return param === "solo" || param === "room" ? param : null;
}

function parseDifficulty(param: string | null): "easy" | "hard" | null {
  return param === "easy" || param === "hard" ? param : null;
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: string;
}) {
  return (
    <div className="min-w-0 px-1 rounded-lg bg-gray-800/60 py-2 text-center">
      <div
        className={`text-lg sm:text-xl font-black tabular-nums truncate ${tone}`}
      >
        {value}
      </div>
      <div className="text-xs uppercase tracking-wider text-gray-500 truncate">
        {label}
      </div>
    </div>
  );
}

function ResultPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [summary, setSummary] = useState<BattleSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot: read session storage after mount to avoid SSR/hydration mismatch */
    setSummary(loadBattleSummary());
  }, []);

  const outcome =
    summary?.outcome ?? parseOutcome(searchParams.get("outcome"));
  const mode = summary?.mode ?? parseMode(searchParams.get("mode"));
  const difficulty =
    summary?.difficulty ??
    parseDifficulty(searchParams.get("difficulty"));

  const playAgain = () => router.push("/solo");

  // PvP: reopen the same room for a rematch — no code typing. rematchRoom
  // resets it only if the battle has ended; the host client then auto-starts
  // once both players are back on the room page.
  const playAgainRoom = async () => {
    const code = summary?.roomCode;
    if (!code) {
      router.push("/");
      return;
    }
    setCreateError(null);
    setCreating(true);
    try {
      const uid = await ensureAnonAuth();
      const pool = await loadWordPool();
      const words = pickBattleWords(pool, WORDS_PER_BATTLE, loadWordStats());
      await rematchRoom(code, uid, words);
      router.push(`/battle/room?id=${code}`);
    } catch (e) {
      console.error(e);
      setCreateError(describeAuthError(e));
      setCreating(false);
    }
  };

  const backToLobby = () => router.push("/");

  if (!outcome) {
    return (
      <Shell>
        <Button onClick={backToLobby}>Back to lobby</Button>
      </Shell>
    );
  }

  const result = RESULT_TEXT[outcome];
  const accuracy =
    summary && summary.answered > 0
      ? Math.round((summary.correct / summary.answered) * 100)
      : null;

  let modeLine: string | null = null;
  if (mode === "solo") {
    const vs = summary?.opponent ?? "BOT";
    modeLine = `Solo battle vs ${vs}${difficulty ? ` · ${difficulty.toUpperCase()}` : ""}`;
  } else if (mode === "room") {
    modeLine = summary?.opponent
      ? `Online battle vs ${summary.opponent}`
      : "Online battle";
  }

  const missed = (summary?.words ?? []).filter((w) => !w.correct);

  return (
    <Shell>
      <div className="flex flex-col items-center w-full animate-popIn">
        <h1
          className={cx(
            "text-6xl sm:text-8xl font-black tracking-widest select-none",
            result.color
          )}
        >
          {result.title}
        </h1>
        {modeLine && (
          <p className="text-xs sm:text-sm uppercase tracking-widest text-gray-400 mt-3">
            {modeLine}
          </p>
        )}

        {summary && summary.answered > 0 && (
          <div className="grid grid-cols-3 gap-2 w-full max-w-xs mt-8">
            <Stat
              label="Correct"
              value={`${summary.correct}/${summary.answered}`}
              tone="text-emerald-400"
            />
            <Stat label="Accuracy" value={`${accuracy}%`} tone="text-blue-400" />
            <Stat
              label="Best streak"
              value={summary.bestStreak}
              tone="text-amber-400"
            />
          </div>
        )}

        {missed.length > 0 && (
          <Card className="w-full max-w-sm mt-4">
            <CardBody className="p-4">
              <p className="text-xs font-black uppercase tracking-wider text-gray-500 mb-2">
                Review these words
              </p>
              <ul>
                {missed.map((m, i) => (
                  <li
                    key={`${m.word}-${i}`}
                    className="py-2 border-b border-gray-800/60 last:border-b-0"
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        onClick={() => playWordAudio(m.pronounce)}
                        className="inline-flex items-center gap-1.5 text-sm font-bold text-gray-700 dark:text-gray-200 hover:text-blue-500 dark:hover:text-blue-400 transition-colors touch-manipulation select-none"
                      >
                        {m.word}
                        {m.pronounce && (
                          <SpeakerWaveIcon className="h-3.5 w-3.5 opacity-60" />
                        )}
                      </button>
                      {m.type && (
                        <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                          {m.type}
                        </span>
                      )}
                    </div>
                    {m.answer && (
                      <p className="mt-0.5 break-words text-sm text-blue-600 dark:text-blue-400">
                        {m.answer}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}

        <div className="flex flex-col gap-3 w-full max-w-xs mt-8">
          {mode === "solo" && (
            <Button onClick={playAgain} className="sm:text-lg sm:py-3.5">
              Play again
            </Button>
          )}
          {mode === "room" && (
            <>
              <Button
                onClick={playAgainRoom}
                disabled={creating}
                className="sm:text-lg sm:py-3.5"
              >
                {creating ? "Creating room..." : "Play again"}
              </Button>
              {createError && (
                <p className="text-xs text-red-400 text-center break-words">
                  {createError}
                </p>
              )}
            </>
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
