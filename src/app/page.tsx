"use client";

import { useEffect, useState } from "react";
import { uniq } from "lodash";
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

  const { filter, setFilter, list, setList, words } = useWordFilter();
  const {
    words: currentWords,
    groups,
    selectedWordIdx,
    matchedWords,
    groupFlash,
    lockedGroups,
    setup,
    selectWord,
    selectGroup,
  } = useVocabRound();

  useEffect(() => setIsClient(true), []);
  useEffect(() => {
    if (words && words.length >= 2) setup(words);
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
      <SwitchMode />

      {/* Controls */}
      <div className="flex flex-wrap mb-5 gap-3 mt-12 lg:mt-5">
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

        <Button onClick={handleReset} className="grow">
          Reset
        </Button>
      </div>

      <Typography className="mb-6 pt-2 text-xl font-medium">
        Total Words: {words?.length}
      </Typography>

      {/* English word cards */}
      <Typography className="mb-3 text-lg font-medium">
        Click a word to hear it, then match to the correct Thai group:
      </Typography>
      <div className="grid grid-cols-2 gap-4 mb-6">
        {currentWords.map((word, idx) => {
          const isSelected = selectedWordIdx === idx;
          const isMatched = matchedWords[idx];
          const types = uniq(word?.entries?.map((e) => e.type) ?? []);

          return (
            <Card
              key={idx}
              onClick={() => selectWord(idx)}
              className={cx(
                "cursor-pointer hover:shadow-lg transition-all border-2",
                isMatched &&
                  "border-green-500 bg-green-50 dark:bg-green-900 opacity-60",
                isSelected &&
                  !isMatched &&
                  "border-blue-500 ring-2 ring-blue-300",
                !isSelected && !isMatched && "border-transparent"
              )}
            >
              <CardBody className="text-center">
                <h3 className="text-xl font-medium mb-1">
                  {word?.word ?? "-"}
                </h3>
                <p className="text-sm mb-2">{word?.level}</p>
                <div className="flex gap-1 justify-center flex-wrap">
                  {types.map((t) => (
                    <span
                      key={t}
                      className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 font-medium"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {/* Thai group cards */}
      <Typography className="mb-4 text-lg font-medium">
        Thai meaning groups:
      </Typography>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-5">
        {groups.map((group, groupIdx) => {
          const flash = groupFlash[groupIdx];
          const isLocked = lockedGroups.includes(groupIdx);
          const isDisabled = selectedWordIdx === null || isLocked;

          return (
            <Card
              key={groupIdx}
              onClick={() => !isDisabled && selectGroup(groupIdx)}
              className={cx(
                "transition-all border-2",
                isDisabled
                  ? "opacity-50 cursor-not-allowed"
                  : "cursor-pointer hover:shadow-lg",
                (flash === "correct" || isLocked) &&
                  "border-green-500 bg-green-100 dark:bg-green-900",
                flash === "wrong" &&
                  "border-red-500 bg-red-100 dark:bg-red-900",
                !flash && !isLocked && "border-transparent",
                isLocked && "opacity-60"
              )}
            >
              <CardBody>
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 font-medium mb-2 inline-block">
                  {group.type}
                </span>
                <div className="space-y-1">
                  {group.entries.map((entry, i) => (
                    <p key={i} className="text-sm">
                      {entry.text}
                    </p>
                  ))}
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
