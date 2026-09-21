"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@emotion/css";
import { SpeakerWaveIcon, FlagIcon } from "@heroicons/react/24/solid";
import type { BattleView } from "../../useBattleRoom";
import { isCritReady } from "../../../game/damage";
import { TURN_MS } from "../../../lib/gameConfig";
import { playSfx } from "../../../lib/sfx";
import { Card, CardBody } from "../ui/Card";
import { AnswerGrid } from "./AnswerGrid";
import { DamagePopup } from "./DamagePopup";
import { FlashOverlay, useCritEffects } from "./EffectLayer";
import { HpBar } from "./HpBar";
import { SoundToggle } from "./SoundToggle";
import { TimerBar } from "./TimerBar";
import { WordProgress } from "./WordProgress";

type BattleScreenProps = {
  view: BattleView;
  myMaxHp: number;
  oppMaxHp: number;
  onAnswer: (answer: string | null) => void;
  onPlayWord: () => void;
  onExit: () => void;
  onViewResult: () => void;
};

export function BattleScreen({
  view,
  myMaxHp,
  oppMaxHp,
  onAnswer,
  onPlayWord,
  onExit,
  onViewResult,
}: BattleScreenProps) {
  const { shake, flash } = useCritEffects(view.popups);
  const ended = view.outcome !== null;
  const critCharged = isCritReady(view.myStreak);

  const [playedWordNumber, setPlayedWordNumber] = useState<number | null>(null);
  const soundUnlocked = playedWordNumber === view.wordNumber;

  const handlePlayWord = () => {
    onPlayWord();
    setPlayedWordNumber(view.wordNumber);
  };

  const handleViewResult = () => {
    if (view.outcome) playSfx(view.outcome);
    onViewResult();
  };

  const seenPopups = useRef<Set<number>>(new Set());
  useEffect(() => {
    for (const p of view.popups) {
      if (seenPopups.current.has(p.id)) continue;
      seenPopups.current.add(p.id);
      if (p.side === "opp") playSfx(p.crit ? "crit" : "hit");
      else playSfx("hurt");
    }
  }, [view.popups]);

  return (
    <div
      className={cx(
        "relative max-w-screen-md m-auto w-full p-4 sm:p-6 select-none",
        shake && "animate-shake",
      )}
    >
      <FlashOverlay active={flash} />

      {/* Word HUD — top */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-xs font-bold tabular-nums text-gray-500 dark:text-gray-400 shrink-0">
          {view.wordNumber} / {view.wordTotal}
        </span>
        <WordProgress
          total={view.wordTotal}
          current={view.wordNumber - 1}
          results={view.wordResults}
        />
      </div>

      {/* Word card */}
      <div
        onClick={handlePlayWord}
        className="mb-3 cursor-pointer hover:scale-[1.01] transition-transform touch-manipulation"
      >
        <Card className="border-2 border-transparent hover:border-blue-400/50">
          <CardBody className="text-center py-4 sm:py-5">
            <h3 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-1 break-words">
              {view.word?.word ?? "..."}
            </h3>
            <div className="flex items-center justify-center gap-2">
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 font-medium">
                {view.word?.type}
              </span>
              <span className="text-xs text-gray-400">
                {soundUnlocked
                  ? "tap word for pronunciation"
                  : "tap to play sound"}
              </span>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Timer */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <TimerBar remainingMs={view.remainingMs} totalMs={TURN_MS} />
        </div>
        <SoundToggle />
      </div>

      {/* Waiting indicator */}
      <div className="mb-2 flex flex-wrap items-center justify-center gap-2 min-h-7">
        {view.waitingOpp && (
          <>
            <span className="inline-flex items-center gap-2 animate-popIn text-xs sm:text-sm font-semibold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-full px-3 py-1">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
              </span>
              Waiting for opponent
              <span className="inline-flex items-end gap-0.5" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-1 w-1 rounded-full bg-blue-400 animate-bounce"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </span>
            </span>
            {view.word && (
              <span
                className={cx(
                  "inline-flex items-center gap-1.5 animate-popIn text-xs sm:text-sm font-semibold",
                  "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40",
                  "rounded-full px-3 py-1 border border-emerald-200 dark:border-emerald-800",
                )}
              >
                Answer:
                <span className="font-bold">{view.word.correctAnswer}</span>
              </span>
            )}
          </>
        )}
      </div>

      {/* Answers */}
      {view.word && !soundUnlocked ? (
        <button
          onClick={handlePlayWord}
          className="w-full py-6 sm:py-8 rounded-xl border-2 border-dashed border-blue-400/60 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300 font-bold text-base sm:text-lg cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/50 active:scale-[0.98] transition-all touch-manipulation select-none animate-popIn flex items-center justify-center gap-2"
        >
          <SpeakerWaveIcon className="w-5 h-5" />
          Tap to play sound
        </button>
      ) : (
        view.word && (
          <AnswerGrid
            word={view.word}
            selected={view.selected}
            answerState={view.answerState}
            disabled={ended || view.answerState !== "idle"}
            crit={critCharged && !ended && view.answerState === "idle"}
            onSelect={(answer) => {
              onAnswer(answer);
            }}
          />
        )
      )}

      {/* HP bars — bottom; damage popups drop into the reserved space below */}
      <div className="relative flex items-start gap-2 sm:gap-3 mt-4 mb-12">
        <div className="relative flex-1">
          <HpBar
            name={view.myName}
            hp={view.myHp}
            max={myMaxHp}
            streak={view.myStreak}
          />
          {view.popups
            .filter((p) => p.side === "me")
            .map((p) => (
              <DamagePopup key={p.id} popup={p} below />
            ))}
        </div>
        <span className="font-black text-base sm:text-2xl text-gray-400 dark:text-gray-500 pt-2 sm:pt-4">
          VS
        </span>
        <div className="relative flex-1">
          <HpBar
            name={view.oppName}
            hp={view.oppHp}
            max={oppMaxHp}
            streak={view.oppStreak}
            flip
          />
          {view.popups
            .filter((p) => p.side === "opp")
            .map((p) => (
              <DamagePopup key={p.id} popup={p} flip below />
            ))}
        </div>
      </div>

      {/* View result tab — navigates to the result page */}
      {ended && (
        <div className="absolute inset-x-0 bottom-2 z-40 flex justify-center px-4">
          <button
            onClick={handleViewResult}
            className="animate-popIn inline-flex items-center gap-2 rounded-full bg-indigo-600 px-6 py-3 text-sm sm:text-base font-black text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 active:scale-95 transition-all touch-manipulation select-none"
          >
            <FlagIcon className="w-5 h-5" />
            View result
          </button>
        </div>
      )}
    </div>
  );
}
