"use client";

import { cx } from "@emotion/css";
import type { BattleWord } from "../../../game/types";
import { Card, CardBody } from "../ui/Card";

type AnswerGridProps = {
  word: BattleWord;
  selected: string | null;
  answerState: "idle" | "correct" | "wrong" | "timeout";
  disabled: boolean;
  onSelect: (answer: string) => void;
};

export function AnswerGrid({
  word,
  selected,
  answerState,
  disabled,
  onSelect,
}: AnswerGridProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
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
                : "cursor-pointer hover:shadow-lg hover:scale-[1.02] active:scale-95",
              isCorrect && "!opacity-100 border-emerald-500 bg-emerald-100 dark:bg-emerald-900 scale-105",
              isWrong && "!opacity-100 border-red-500 bg-red-100 dark:bg-red-900",
              showReal && !isCorrect && "!opacity-100 border-emerald-500 bg-emerald-100 dark:bg-emerald-900"
            )}
          >
            <CardBody className="p-3">
              <ul className="space-y-0.5 list-disc list-inside">
                {option.split(", ").map((text, i) => (
                  <li key={i} className="text-sm">
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
