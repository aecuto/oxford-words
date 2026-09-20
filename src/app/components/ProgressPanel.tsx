"use client";

import { useEffect, useState } from "react";
import { FireIcon } from "@heroicons/react/24/solid";
import { Card, CardBody } from "./ui/Card";
import { loadWordPool } from "../../game/wordPool";
import {
  loadDailyProgress,
  loadWordStats,
  type DailyProgress,
  type WordStats,
} from "../../game/wordProgress";
import { DAILY_GOAL_CORRECT } from "../../lib/gameConfig";
import { fetchProgress, type Progress } from "../../game/progressService";
import { ensureAnonAuth } from "../../lib/firebase";

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
    <div className="rounded-lg bg-gray-800/60 py-2">
      <div className={`text-lg font-black tabular-nums ${tone}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500">
        {label}
      </div>
    </div>
  );
}

export function ProgressPanel() {
  const [poolTotal, setPoolTotal] = useState(0);
  const [stats, setStats] = useState<WordStats>({});
  const [record, setRecord] = useState<Progress | null>(null);
  const [daily, setDaily] = useState<DailyProgress | null>(null);

  useEffect(() => {
    let alive = true;
    loadWordPool()
      .then((pool) => {
        if (!alive) return;
        setPoolTotal(pool.length);
        setStats(loadWordStats());
        setDaily(loadDailyProgress());
      })
      .catch((e) => console.error("progress:pool", e));
    (async () => {
      try {
        const uid = await ensureAnonAuth();
        const p = await fetchProgress(uid);
        if (alive) setRecord(p);
      } catch (e) {
        console.error("progress:record", e);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const entries = Object.values(stats);
  const mastered = entries.filter((s) => s.correct > s.wrong).length;
  const seen = entries.length;
  const learning = seen - mastered;
  const showRecord = record != null && record.games > 0;

  return (
    <Card className="mb-5 sm:mb-8">
      <CardBody className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="text-base sm:text-lg font-black tracking-wide text-gray-200">
            PROGRESS
          </h2>
          <span className="text-xs text-gray-500 tabular-nums">
            {seen} / {poolTotal} words seen
          </span>
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

        <div className="grid grid-cols-3 gap-2">
          <Stat label="Mastered" value={mastered} tone="text-emerald-400" />
          <Stat label="Learning" value={learning} tone="text-blue-400" />
          <Stat
            label="Seen"
            value={`${seen}/${poolTotal}`}
            tone="text-gray-300"
          />
        </div>

        <div className="mt-4 pt-3 border-t border-gray-800">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-500">
              Today
            </span>
            <span className="text-xs text-gray-400 tabular-nums">
              {daily?.correct ?? 0} / {DAILY_GOAL_CORRECT} correct
            </span>
          </div>
          <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
            <div
              className="h-full bg-amber-500 transition-all"
              style={{
                width: pct(daily?.correct ?? 0, DAILY_GOAL_CORRECT),
              }}
            />
          </div>
          {(daily?.streak ?? 0) > 0 && (
            <div className="mt-1.5 flex items-center gap-1 text-xs font-bold text-amber-400">
              <FireIcon className="h-3.5 w-3.5" />
              {daily!.streak}-day streak
            </div>
          )}
        </div>

        {showRecord && (
          <div className="mt-4 pt-3 border-t border-gray-800 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-gray-400">
            <span>{record!.games} battles</span>
            <span className="text-emerald-400 font-bold">
              {record!.wins}W
            </span>
            <span className="text-red-400 font-bold">{record!.losses}L</span>
            {record!.draws > 0 && <span>{record!.draws}D</span>}
            <span>best streak {record!.bestStreak}</span>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
