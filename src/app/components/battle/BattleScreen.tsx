"use client";

import { useEffect, useRef } from "react";
import { cx } from "@emotion/css";
import type { BattleView } from "../../useBattleRoom";
import { isCritReady } from "../../../game/damage";
import { TURN_MS } from "../../../lib/gameConfig";
import { playSfx } from "../../../lib/sfx";
import { Card, CardBody } from "../ui/Card";
import { Button } from "../ui/Button";
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
  allowTimeoutSubmit: boolean;
  onAnswer: (answer: string | null) => void;
  onPlayWord: () => void;
  onExit: () => void;
  onRematch?: () => void;
};

const RESULT_TEXT = {
  win: { title: "VICTORY", color: "text-emerald-500" },
  lose: { title: "DEFEAT", color: "text-red-500" },
  draw: { title: "DRAW", color: "text-amber-500" },
} as const;

export function BattleScreen({
  view,
  myMaxHp,
  oppMaxHp,
  allowTimeoutSubmit,
  onAnswer,
  onPlayWord,
  onExit,
  onRematch,
}: BattleScreenProps) {
  const { shake, flash } = useCritEffects(view.popups);
  const ended = view.outcome !== null;
  const result = view.outcome ? RESULT_TEXT[view.outcome] : null;
  const critCharged = isCritReady(view.myStreak);

  const seenPopups = useRef<Set<number>>(new Set());
  useEffect(() => {
    for (const p of view.popups) {
      if (seenPopups.current.has(p.id)) continue;
      seenPopups.current.add(p.id);
      if (p.side === "opp") playSfx(p.crit ? "crit" : "hit");
      else playSfx("hurt");
    }
  }, [view.popups]);

  const outcome = view.outcome;
  useEffect(() => {
    if (!outcome) return;
    const t = window.setTimeout(() => playSfx(outcome), 600);
    return () => window.clearTimeout(t);
  }, [outcome]);

  return (
    <div
      className={cx(
        "relative max-w-screen-md m-auto w-full p-4 sm:p-6 select-none",
        shake && "animate-shake",
      )}
    >
      <FlashOverlay active={flash} />

      {/* HP bars */}
      <div className="relative flex items-start gap-2 sm:gap-3 mb-3 sm:mb-4">
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
              <DamagePopup key={p.id} popup={p} />
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
              <DamagePopup key={p.id} popup={p} flip />
            ))}
        </div>
      </div>

      {/* Word progress */}
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

      {/* Timer */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1">
          <TimerBar remainingMs={view.remainingMs} totalMs={TURN_MS} />
        </div>
        <SoundToggle />
      </div>

      {/* Word card */}
      <div
        onClick={onPlayWord}
        className="mb-3 sm:mb-4 cursor-pointer hover:scale-[1.01] transition-transform touch-manipulation"
      >
        <Card className="border-2 border-transparent hover:border-blue-400/50">
          <CardBody className="text-center py-4 sm:py-6">
            <h3 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-1 break-words">
              {view.word?.word ?? "..."}
            </h3>
            <div className="flex items-center justify-center gap-2">
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 font-medium">
                {view.word?.type}
              </span>
              <span className="text-xs text-gray-400">
                tap word for pronunciation
              </span>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Feedback */}
      <div className="mb-2 grid grid-rows-[2.25rem_1.75rem] sm:grid-rows-[2.5rem_1.75rem] justify-items-center">
        <div className="flex items-center justify-center w-full">
          {view.feedback ? (
            <span
              className={cx(
                "animate-popIn text-xl font-black tracking-wide",
                view.feedback.tone === "good"
                  ? view.feedback.crit
                    ? "text-orange-400"
                    : "text-emerald-500"
                  : "text-red-500",
              )}
            >
              {view.feedback.text}
              {view.feedback.damage > 0 && (
                <span className="ml-1 tabular-nums">−{view.feedback.damage}</span>
              )}
            </span>
          ) : null}
        </div>
        <div className="flex items-center justify-center w-full">
          {view.waitingOpp && (
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
          )}
        </div>
      </div>

      {/* Answers */}
      {view.word && (
        <AnswerGrid
          word={view.word}
          selected={view.selected}
          answerState={view.answerState}
          disabled={ended || view.answerState !== "idle"}
          crit={critCharged && !ended && view.answerState === "idle"}
          onSelect={(answer) => {
            if (view.word && answer === view.word.correctAnswer) onPlayWord();
            onAnswer(answer);
          }}
        />
      )}

      {allowTimeoutSubmit && !ended && view.answerState === "idle" && (
        <div className="flex justify-center mt-3">
          <Button
            onClick={() => onAnswer(null)}
            variant="gray"
            className="text-sm px-4 py-2"
          >
            Give up this word
          </Button>
        </div>
      )}

      {/* Result overlay */}
  {ended && result && (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 rounded-xl p-4">
      <Card className="w-full max-w-xs animate-popIn">
        <CardBody className="text-center space-y-3 p-5 sm:p-6">
          <h2
            className={cx("text-2xl sm:text-3xl font-black", result.color)}
          >
            {result.title}
          </h2>
          <div className="flex flex-col gap-2 pt-2">
            {onRematch && <Button onClick={onRematch}>Play again</Button>}
            <Button onClick={onExit} variant="gray">
              Back to lobby
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  )}
    </div>
  );
}
