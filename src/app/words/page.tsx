"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SpeakerWaveIcon } from "@heroicons/react/24/solid";
import { Card, CardBody } from "../components/ui/Card";
import { dedupeWords, getCorrectAnswer, loadWordPool } from "../../game/wordPool";
import {
  isMastered,
  loadWordStats,
  type WordStat,
  type WordStats,
} from "../../game/wordProgress";
import type { Word } from "../../game/types";
import { playWordAudio } from "../playWordAudio";

type WordFilter = "learning" | "mastered";

type ListedWord = {
  word: string;
  pronounceURL: string;
  type: string;
  level: string;
  thai: string;
  stat: WordStat;
};

// Type badges stay tiny; only the four POS labels in the data get a short form.
const TYPE_BADGE: Record<string, string> = {
  noun: "N",
  verb: "V",
  adjective: "ADJ",
  adverb: "ADV",
};

function toListedWords(pool: Word[], stats: WordStats): ListedWord[] {
  const byWord = new Map(dedupeWords(pool).map((w) => [w.word, w]));
  return Object.entries(stats)
    .filter(([word, stat]) => stat.seen > 0 && byWord.has(word))
    .map(([word, stat]) => {
      const w = byWord.get(word)!;
      return {
        word,
        pronounceURL: w.pronounceURL,
        type: w.type,
        level: w.level,
        thai: getCorrectAnswer(w),
        stat,
      };
    })
    .sort((a, b) => a.word.localeCompare(b.word));
}

const DAY_MS = 86_400_000;

function WordRow({
  item,
  mastered,
  now,
}: {
  item: ListedWord;
  mastered: boolean;
  now: number;
}) {
  const badge = TYPE_BADGE[item.type.toLowerCase()];
  // Retry words (ivl 0) are always due — that is the "active review" half of
  // the 2-option rule. Mastered words count down to their 14-day review.
  const dueAt = item.stat.lastSeenAt + (item.stat.ivl ?? 0) * DAY_MS;
  const daysLeft = Math.ceil((dueAt - now) / DAY_MS);
  const dueNow = daysLeft <= 0;
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-gray-800/60">
      <span
        className={`shrink-0 h-2 w-2 rounded-full ${
          mastered
            ? "bg-emerald-500"
            : "bg-blue-500 animate-pulse"
        }`}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 flex-wrap">
          <span className="text-sm sm:text-base font-bold text-white truncate">
            {item.word}
          </span>
          {badge && (
            <span
              className={`text-[10px] font-black uppercase px-1.5 py-0.5 rounded ${
                mastered
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-blue-500/15 text-blue-400"
              }`}
            >
              {badge}
            </span>
          )}
          <span className="text-[10px] uppercase tracking-wide text-gray-500">
            {item.level}
          </span>
        </span>
        <span className="block text-xs text-gray-400 truncate">{item.thai}</span>
      </span>
      <span
        className={`shrink-0 text-[10px] font-bold uppercase tracking-wide tabular-nums ${
          dueNow
            ? mastered
              ? "text-emerald-400"
              : "text-blue-400"
            : "text-gray-500"
        }`}
      >
        {dueNow ? "due now" : `in ${daysLeft}d`}
      </span>
      <button
        onClick={() => playWordAudio(item.pronounceURL)}
        disabled={!item.pronounceURL}
        aria-label={`Play ${item.word}`}
        className="shrink-0 p-2 rounded-full text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-40 transition-colors"
      >
        <SpeakerWaveIcon className="h-4 w-4" />
      </button>
    </li>
  );
}

// Deep link ?filter=learning|mastered (lobby progress tiles) opens the tab.
function parseFilter(param: string | null): WordFilter {
  return param === "mastered" ? "mastered" : "learning";
}

export default function WordsPage() {
  return (
    <Suspense
      fallback={
        <div className="dark flex w-full min-h-dvh items-center justify-center">
          <div className="loader" />
        </div>
      }
    >
      <WordsPageInner />
    </Suspense>
  );
}

function WordsPageInner() {
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<WordFilter>(() =>
    parseFilter(searchParams.get("filter")),
  );
  const [words, setWords] = useState<ListedWord[] | null>(null);
  // Clock captured once at load time; due countdowns don't need to tick live.
  const [loadedAt, setLoadedAt] = useState(0);

  useEffect(() => {
    let alive = true;
    Promise.all([loadWordPool(), Promise.resolve(loadWordStats())])
      .then(([pool, stats]) => {
        if (alive) {
          setWords(toListedWords(pool, stats));
          setLoadedAt(Date.now());
        }
      })
      .catch((e) => console.error("words:load", e));
    return () => {
      alive = false;
    };
  }, []);

  const counts = useMemo(() => {
    const all = words ?? [];
    return {
      mastered: all.filter((w) => isMastered(w.stat)).length,
      learning: all.filter((w) => !isMastered(w.stat)).length,
    };
  }, [words]);

  const visible = useMemo(() => {
    const list = (words ?? []).filter((w) =>
      filter === "mastered" ? isMastered(w.stat) : !isMastered(w.stat),
    );
    // Study tab is the active-review queue: stalest first is the order the
    // picker will deal them. Mastered stays alphabetical.
    return list.sort((a, b) =>
      filter === "mastered"
        ? a.word.localeCompare(b.word)
        : a.stat.lastSeenAt - b.stat.lastSeenAt,
    );
  }, [words, filter]);

  return (
    <div className="dark min-h-dvh pt-safe pb-safe">
      <div className="px-3 sm:px-6 m-auto w-full max-w-screen-md pt-6 sm:pt-10 pb-8 sm:pb-12">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h1 className="text-2xl sm:text-3xl font-black tracking-wide text-gray-200">
            My Words
          </h1>
          <Link
            href="/"
            className="text-xs font-bold uppercase tracking-wide text-blue-400 hover:text-blue-300"
          >
            ← Lobby
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-2">
          <button
            onClick={() => setFilter("learning")}
            className={`px-4 py-2.5 rounded-lg border-2 font-black uppercase tracking-wide text-sm transition-colors ${
              filter === "learning"
                ? "border-blue-500 bg-blue-500/10 text-blue-400"
                : "border-gray-700 bg-gray-800/60 text-gray-400 hover:border-gray-600"
            }`}
          >
            Study
            <span className="ml-2 tabular-nums">
              {words === null ? "…" : counts.learning}
            </span>
          </button>
          <button
            onClick={() => setFilter("mastered")}
            className={`px-4 py-2.5 rounded-lg border-2 font-black uppercase tracking-wide text-sm transition-colors ${
              filter === "mastered"
                ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                : "border-gray-700 bg-gray-800/60 text-gray-400 hover:border-gray-600"
            }`}
          >
            Mastered
            <span className="ml-2 tabular-nums">
              {words === null ? "…" : counts.mastered}
            </span>
          </button>
        </div>
        <p className="text-[11px] text-gray-500 mb-4">
          Answer correctly in under 2 seconds → Mastered. Hesitate, guess or
          miss → back to Study.
        </p>

        <Card>
          <CardBody className="p-2 sm:p-3">
            {words === null ? (
              <div className="flex justify-center py-10">
                <div className="loader" />
              </div>
            ) : visible.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-10 px-4">
                {filter === "mastered"
                  ? "No mastered words yet — answer a word in under two seconds to master it."
                  : "Nothing to study yet — play a battle to start collecting words."}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {visible.map((item) => (
                  <WordRow
                    key={item.word}
                    item={item}
                    mastered={isMastered(item.stat)}
                    now={loadedAt}
                  />
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
