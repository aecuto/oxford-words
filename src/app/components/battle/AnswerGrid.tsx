"use client";

import { cx } from "@emotion/css";
import type { AnswerState, BattleWord } from "../../../game/types";
import { Card, CardBody } from "../ui/Card";

type AnswerGridProps = {
  word: BattleWord;
  selected: string | null;
  answerState: AnswerState;
  disabled: boolean;
  crit?: boolean;
  onSelect: (answer: string) => void;
};

export function AnswerGrid({
  word,
  selected,
  answerState,
  disabled,
  crit = false,
  onSelect,
}: AnswerGridProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 auto-rows-fr gap-2 sm:gap-3 select-none touch-manipulation">
      {word.options.map((option, idx) => {
        const isSelected = selected === option;
        const isCorrect = isSelected && answerState === "correct";
        const isWrong =
          isSelected && (answerState === "wrong" || answerState === "timeout");
        const showReal =
          answerState !== "idle" && option === word.correctAnswer;
        return (
          <Card
            key={idx}
            onClick={() => !disabled && onSelect(option)}
            className={cx(
              "h-full border-2 transition-all",
              answerState !== "idle"
                ? "opacity-60 cursor-not-allowed"
                : "cursor-pointer hover:shadow-lg active:scale-95",
              isCorrect &&
                "!opacity-100 border-emerald-500 bg-emerald-100 dark:bg-emerald-900 scale-105",
              isWrong &&
                "!opacity-100 border-red-500 bg-red-100 dark:bg-red-900",
              showReal &&
                !isCorrect &&
                "!opacity-100 border-emerald-500 bg-emerald-100 dark:bg-emerald-900",
              crit &&
                answerState === "idle" &&
                "border-yellow-400 bg-yellow-50 dark:bg-yellow-900/40 shadow-[0_0_10px_rgba(250,204,21,0.4)]",
            )}
          >
            <CardBody className="p-3 sm:p-4 min-h-[3.75rem] h-full flex items-center">
              {/* Thai needs a bigger size and loose leading: vowel and tone
                  marks stack above/below the glyphs and clip when tight. */}
              <div className="w-full flex flex-col justify-center gap-1">
                {option.split(", ").map((text, i) => (
                  <span
                    key={i}
                    className="text-base sm:text-lg leading-relaxed text-left"
                  >
                    {text}
                  </span>
                ))}
              </div>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
