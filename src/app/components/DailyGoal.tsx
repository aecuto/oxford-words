"use client";

import { FireIcon } from "@heroicons/react/24/solid";
import type { DailyProgress } from "../../game/wordProgress";
import { DAILY_GOAL_CORRECT } from "../../lib/gameConfig";

function pct(part: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.min(100, (part / total) * 100)}%`;
}

export function DailyGoal({
  daily,
  className,
}: {
  daily: DailyProgress | null;
  className?: string;
}) {
  const correct = daily?.correct ?? 0;
  const streak = daily?.streak ?? 0;

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-black uppercase tracking-wider text-gray-500">
          Today
        </span>
        <span className="text-xs text-gray-400 tabular-nums">
          {correct} / {DAILY_GOAL_CORRECT} unique correct
        </span>
      </div>
      <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
        <div
          className="h-full bg-amber-500 transition-all"
          style={{ width: pct(correct, DAILY_GOAL_CORRECT) }}
        />
      </div>
      {streak > 0 && (
        <div className="mt-1.5 flex items-center gap-1 text-xs font-bold text-amber-400">
          <FireIcon className="h-3.5 w-3.5" />
          {streak}-day streak
        </div>
      )}
    </div>
  );
}
