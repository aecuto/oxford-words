"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Card, CardBody } from "./ui/Card";
import { DailyGoal } from "./DailyGoal";
import { loadWordPool } from "../../game/wordPool";
import {
  currentDailyProgress,
  isMastered,
  loadWordStats,
} from "../../game/wordProgress";
import { fetchProgress } from "../../game/progressService";
import { ensureAnonAuth } from "../../lib/firebase";
import type { WordList } from "../../lib/gameConfig";
import { useProgressStore } from "../stores/progressStore";

function pct(part: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.min(100, (part / total) * 100)}%`;
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: string;
}) {
  return (
    <div className="min-w-0 px-1 rounded-lg bg-gray-800/60 py-2">
      <div
        className={`text-base sm:text-lg font-black tabular-nums truncate ${tone}`}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 truncate">
        {label}
      </div>
    </div>
  );
}

export function ProgressPanel({ list }: { list?: WordList }) {
  const {
    poolTotal,
    counts,
    record,
    daily,
    setPoolTotal,
    setCounts,
    setRecord,
    setDaily,
  } = useProgressStore();

  // Per-list counts + pool denominator: the SRS store is one global map keyed
  // by headword, but the two lists are exclusive, so intersecting its keys
  // with the selected pool scopes seen/mastered/learning to the active list
  // (same rule as toListedWords on /words). Refetches on a word-list switch
  // (both pools stay memoized, so this is instant after the first look).
  useEffect(() => {
    let alive = true;
    Promise.all([loadWordPool(list), Promise.resolve(loadWordStats())])
      .then(([pool, stats]) => {
        if (!alive) return;
        setPoolTotal(pool.length);
        let seen = 0;
        let mastered = 0;
        for (const w of pool) {
          const s = stats[w.word];
          if (s && s.seen > 0) {
            seen++;
            if (isMastered(s)) mastered++;
          }
        }
        setCounts({ seen, mastered });
      })
      .catch((e) => console.error("progress:pool", e));
    return () => {
      alive = false;
    };
  }, [list, setPoolTotal, setCounts]);

  // Daily goal and match record stay list-independent.
  useEffect(() => {
    let alive = true;
    Promise.resolve(currentDailyProgress()).then((d) => {
      if (alive) setDaily(d);
    });
    (async () => {
      try {
        const uid = await ensureAnonAuth();
        const p = await fetchProgress(uid);
        if (alive) setRecord(p);
      } catch (e) {
        console.error("progress:record", e);
      }
    })();
    // Roll the daily record over at midnight even while the page stays open.
    const dayTimer = window.setInterval(() => {
      setDaily(currentDailyProgress());
    }, 60_000);
    return () => {
      alive = false;
      window.clearInterval(dayTimer);
    };
  }, [setDaily, setRecord]);

  const seen = counts.seen;
  const mastered = counts.mastered;
  const learning = seen - mastered;
  const showRecord = record != null && record.games > 0;

  return (
    <Card className="mb-5 sm:mb-8">
      <CardBody className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 mb-3">
          <h2 className="text-base sm:text-lg font-black tracking-wide text-gray-200">
            PROGRESS
          </h2>
          <Link
            href="/words"
            className="text-xs text-gray-500 tabular-nums hover:text-blue-400 transition-colors"
          >
            {seen} / {poolTotal} words seen · view →
          </Link>
        </div>

        <div className="h-2 rounded-full bg-gray-800 overflow-hidden flex mb-4">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: pct(mastered, poolTotal) }}
          />
          <div
            className="h-full bg-blue-500 transition-all"
            style={{ width: pct(learning, poolTotal) }}
          />
        </div>

        <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
          <Link href="/words?filter=mastered" className="block">
            <Stat label="Mastered" value={mastered} tone="text-emerald-400" />
          </Link>
          <Link href="/words?filter=learning" className="block">
            <Stat label="Study" value={learning} tone="text-blue-400" />
          </Link>
          <Link href="/words" className="block">
            <Stat
              label="Seen"
              value={`${seen}/${poolTotal}`}
              tone="text-gray-300"
            />
          </Link>
        </div>

        <DailyGoal
          daily={daily}
          className="mt-4 pt-3 border-t border-gray-800"
        />

        {showRecord && (
          <div className="mt-4 pt-3 border-t border-gray-800 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-gray-400">
            <span>{record!.games} battles</span>
            <span className="text-emerald-400 font-bold">{record!.wins}W</span>
            <span className="text-red-400 font-bold">{record!.losses}L</span>
            {record!.draws > 0 && <span>{record!.draws}D</span>}
            <span>best streak {record!.bestStreak}</span>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
