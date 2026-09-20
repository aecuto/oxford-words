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
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 select-none touch-manipulation">
      {word.options.map((option, idx) => {
        const isSelected = selected === option;
        const isCorrect = isSelected && answerState === "correct";
        const isWrong = isSelected && (answerState === "wrong" || answerState === "timeout");
        const showReal = answerState !== "idle" && option === word.correctAnswer;
        return (
          <Card
            key={idx}
            onClick={() => !disabled && onSelect(option)}
            className={cx(
              "border-2 transition-all",
              answerState !== "idle"
                ? "opacity-60 cursor-not-allowed"
                : "cursor-pointer hover:shadow-lg active:scale-95",
              isCorrect && "!opacity-100 border-emerald-500 bg-emerald-100 dark:bg-emerald-900 scale-105",
              isWrong && "!opacity-100 border-red-500 bg-red-100 dark:bg-red-900",
              showReal && !isCorrect && "!opacity-100 border-emerald-500 bg-emerald-100 dark:bg-emerald-900",
              crit &&
                answerState === "idle" &&
                "border-yellow-400 bg-yellow-50 dark:bg-yellow-900/40 shadow-[0_0_10px_rgba(250,204,21,0.4)]"
            )}
          >
            <CardBody className="p-2.5 sm:p-3 min-h-[3.25rem] flex items-center">
              <ul className="space-y-0.5 list-disc list-inside w-full">
                {option.split(", ").map((text, i) => (
                  <li key={i} className="text-[13px] sm:text-sm leading-snug">
                    {text}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
