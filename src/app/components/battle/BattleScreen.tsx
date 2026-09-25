"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@emotion/css";
import { FlagIcon } from "@heroicons/react/24/solid";
import type { BattleView } from "../../useBattleRoom";
import { isCritReady } from "../../../game/damage";
import { TURN_MS } from "../../../lib/gameConfig";
import { playSfx, preloadSfx } from "../../../lib/sfx";
import { preloadWordAudio } from "../../playWordAudio";
import { AnswerGrid } from "./AnswerGrid";
import { DamagePopup } from "./DamagePopup";
import { FlashOverlay, useCritEffects } from "./EffectLayer";
import { HpBar } from "./HpBar";
import { Logo } from "../Logo";
import { TimerBar } from "./TimerBar";
import { WordPlayBox } from "./WordPlayBox";
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

  const viewResultButton = (
    <button
      onClick={handleViewResult}
      className="animate-popIn inline-flex items-center gap-2 rounded-full bg-indigo-600 px-6 py-3 text-sm sm:text-base font-black text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 active:scale-95 transition-all touch-manipulation select-none"
    >
      <FlagIcon className="w-5 h-5" />
      View result
    </button>
  );

  const seenPopups = useRef<Set<number>>(new Set());
  useEffect(() => {
    for (const p of view.popups) {
      if (seenPopups.current.has(p.id)) continue;
      seenPopups.current.add(p.id);
      if (p.side === "opp") playSfx(p.crit ? "crit" : "hit");
      else playSfx("hurt");
    }
  }, [view.popups]);

  // Preload audio off the interaction path: battle SFX once on mount, and the
  // current word's pronunciation whenever the word changes.
  useEffect(() => {
    preloadSfx();
  }, []);

  useEffect(() => {
    preloadWordAudio(view.word?.pronounceURL);
  }, [view.word?.pronounceURL]);

  return (
    <div
      className={cx(
        "relative mx-auto flex min-h-screen w-full max-w-screen-md flex-col p-4 sm:p-6 select-none",
        shake && "animate-shake",
      )}
    >
      <FlashOverlay active={flash} />

      <Logo size="sm" className="mb-2" />

      {/* Word HUD — top */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-xs font-bold tabular-nums text-gray-500 dark:text-gray-400 shrink-0">
          {view.wordNumber} / {view.wordTotal}
        </span>
        <WordProgress
          total={view.wordTotal}
          current={view.wordNumber - 1}
          results={view.wordResults}
          marks={view.wordMarks}
        />
      </div>

      {/* Timer — stopped/hidden once the battle has ended */}
      {!ended && (
        <div className="mb-2">
          <TimerBar startedAt={view.turnStartedAt} totalMs={TURN_MS} />
        </div>
      )}

      {/* HP bars — top HUD, full width so both bars stay readable on phones */}
      <div className="relative flex w-full items-start gap-1.5 sm:gap-3 mt-2 mb-3">
        <div className="relative flex-1 min-w-0">
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
        <span className="font-black text-sm sm:text-2xl text-gray-400 dark:text-gray-500 pt-1.5 sm:pt-4 shrink-0">
          VS
        </span>
        <div className="relative flex-1 min-w-0">
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

      {/* Word box — tap to play the sound; the word and answers appear inside.
          Once the battle ends, it is replaced by the view result box. */}
      {ended ? (
        <div className="flex justify-center">{viewResultButton}</div>
      ) : (
        view.word && (
          <WordPlayBox
            word={view.word}
            played={soundUnlocked}
            onTap={handlePlayWord}
          >
            {soundUnlocked && (
              <AnswerGrid
                word={view.word}
                selected={view.selected}
                answerState={view.answerState}
                disabled={view.answerState !== "idle"}
                crit={critCharged && view.answerState === "idle"}
                onSelect={(answer) => {
                  onAnswer(answer);
                }}
              />
            )}
          </WordPlayBox>
        )
      )}

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
                <span className="font-bold text-sm sm:text-base leading-relaxed">
                  {view.word.correctAnswer}
                </span>
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
