"use client";

import { type ReactNode } from "react";
import { cx } from "@emotion/css";
import { SpeakerWaveIcon } from "@heroicons/react/24/solid";
import type { BattleWord } from "../../../game/types";
import { Card, CardBody } from "../ui/Card";

type WordPlayBoxProps = {
  word: BattleWord;
  /** True once the word's sound has been played; the word is shown inside. */
  played: boolean;
  onTap: () => void;
  /** Answer options rendered inside the box, below the word, after playing. */
  children?: ReactNode;
};

/**
 * Full-size box in the answer area.
 * Before playing: shows a tap prompt. After playing: shows the word with the
 * answer options inside the same box. Tapping the word replays the sound;
 * taps on the answers stay isolated from it.
 */
export function WordPlayBox({ word, played, onTap, children }: WordPlayBoxProps) {
  return (
    <Card
      onClick={onTap}
      className={cx(
        "w-full border-2 cursor-pointer select-none touch-manipulation",
        "transition-all hover:shadow-lg animate-popIn",
        played
          ? "border-transparent hover:border-blue-400/60"
          : "border-blue-400/60 bg-blue-50/50 dark:bg-blue-950/20 active:scale-[0.98]",
      )}
    >
      <CardBody
        className={cx(
          "text-center flex flex-col items-center justify-center",
          played ? "gap-3" : "gap-2 min-h-[8rem] sm:min-h-[9rem]",
        )}
      >
        {played ? (
          <>
            <span className="text-3xl sm:text-4xl md:text-5xl font-bold break-words">
              {word.word}
            </span>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {word.type && (
                <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                  {word.type}
                </span>
              )}
              {word.level && (
                <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                  {word.level}
                </span>
              )}
            </div>
            <div
              className="w-full"
              onClick={(e) => e.stopPropagation()}
            >
              {children}
            </div>
          </>
        ) : (
          <>
            <span className="text-3xl sm:text-4xl md:text-5xl font-bold break-words">
              {word.word}
            </span>
            {word.type && (
              <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                {word.type}
              </span>
            )}
            <SpeakerWaveIcon className="w-6 h-6 text-blue-500 dark:text-blue-400 animate-bounce" />
          </>
        )}
      </CardBody>
    </Card>
  );
}
