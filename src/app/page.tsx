"use client";

import { useEffect, useState } from "react";
import { db } from "./db";
import wordsJson from "../../translator/words.th.json";
import { useTheme } from "next-themes";
import { cx } from "@emotion/css";
import SwitchMode from "./components/switch-mode";
import { useWordFilter, FILTER_OPTIONS, LIST_OPTIONS } from "./useWordFilter";
import { useVocabRound } from "./useVocabRound";
import { Card, CardBody } from "./components/ui/Card";
import { Button } from "./components/ui/Button";
import { Select } from "./components/ui/Select";
import { Typography } from "./components/ui/Typography";

export default function Home() {
  const { theme } = useTheme();
  const [isClient, setIsClient] = useState(false);

  const { filter, setFilter, list, setList, words, total } = useWordFilter();
  const {
    currentWord,
    answers,
    selectedAnswer,
    answerState,
    progress,
    setup,
    selectAnswer,
  } = useVocabRound();

  useEffect(() => setIsClient(true), []);
  useEffect(() => {
    if (words && words.length >= 10) setup(words);
  }, [words, setup]);

  const handleReset = () => {
    db.words.clear();
    db.words.bulkAdd(wordsJson);
  };

  if (!isClient) {
    return (
      <div className="flex w-full h-screen items-center justify-center">
        <div className="loader" />
      </div>
    );
  }

  return (
    <div
      className={cx("p-2 m-auto max-w-screen-md", theme === "dark" && "dark")}
    >
      {/* Overview */}
      <div className="flex items-center justify-between mb-5 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800">
        <div className="flex items-center gap-2">
          <span className="text-emerald-500 text-sm">✓</span>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {(total ?? 0) - (words?.length ?? 0)}
            <span className="text-gray-400 font-normal"> / {total}</span>
          </span>
        </div>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
          {total
            ? Math.round(((total - (words?.length ?? 0)) / total) * 100)
            : 0}
          %
        </span>
      </div>

      {/* Progress */}
      <div className="flex items-center gap-2 mb-4 text-sm text-gray-500 dark:text-gray-400">
        <span>
          {progress.current} / {progress.total}
        </span>
        <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-500"
            style={{ width: `${(progress.current / progress.total) * 100}%` }}
          />
        </div>
      </div>

      {/* Current word card */}
      <div className="grid grid-cols-1 gap-4 mb-6">
        <Card
          onClick={() =>
            currentWord?.pronounce &&
            new Audio(currentWord.pronounce).play().catch(() => {})
          }
          className="cursor-pointer hover:shadow-lg transition-all border-2 border-transparent"
        >
          <CardBody className="text-center">
            <h3 className="text-xl font-medium mb-1">
              {currentWord?.word ?? "-"}
            </h3>
            <p className="text-sm mb-2">{currentWord?.level}</p>
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 font-medium">
              {currentWord?.type}
            </span>
          </CardBody>
        </Card>
      </div>

      {/* Answer cards */}
      <Typography className="mb-4 text-lg font-medium">
        Thai meaning groups:
      </Typography>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-5">
        {answers.map((answer, idx) => {
          const isSelected = selectedAnswer === answer;
          const isCorrect = isSelected && answerState === "correct";
          const isWrong = isSelected && answerState === "wrong";

          return (
            <Card
              key={idx}
              onClick={() => selectAnswer(answer)}
              className={cx(
                "transition-all border-2",
                answerState !== "idle"
                  ? "opacity-50 cursor-not-allowed"
                  : "cursor-pointer hover:shadow-lg",
                isCorrect && "border-green-500 bg-green-100 dark:bg-green-900",
                isWrong && "border-red-500 bg-red-100 dark:bg-red-900",
                !isCorrect && !isWrong && "border-transparent",
              )}
            >
              <CardBody>
                <ul className="space-y-1 list-disc list-inside">
                  {answer.split(", ").map((text, i) => (
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

      {/* Controls */}
      <div className="space-y-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
        <div className="flex flex-wrap gap-3">
          <div className="w-72">
            <Select
              value={filter}
              onChange={(val) => setFilter(val as typeof filter)}
              options={FILTER_OPTIONS}
            />
          </div>
          <div className="w-72">
            <Select
              value={list}
              onChange={(val) => setList(val as typeof list)}
              options={LIST_OPTIONS}
            />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <SwitchMode />
          <Button onClick={handleReset} className="lg:text-lg lg:py-3">
            Reset
          </Button>
        </div>
      </div>
    </div>
  );
}
