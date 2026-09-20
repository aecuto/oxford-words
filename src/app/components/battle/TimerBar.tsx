"use client";

import { cx } from "@emotion/css";

type TimerBarProps = {
  remainingMs: number;
  totalMs: number;
};

export function TimerBar({ remainingMs, totalMs }: TimerBarProps) {
  const ratio = Math.max(0, Math.min(1, remainingMs / totalMs));
  const seconds = Math.ceil(remainingMs / 1000);
  const urgent = remainingMs <= 3000;
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-3 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden border border-gray-300 dark:border-gray-600">
        <div
          className={cx(
            "h-full rounded-full transition-colors",
            urgent
              ? "bg-red-500 animate-pulse"
              : ratio > 0.5
                ? "bg-blue-500"
                : "bg-amber-500"
          )}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <span
        className={cx(
          "w-8 text-center font-mono font-black text-lg tabular-nums",
          urgent && "text-red-500"
        )}
      >
        {seconds}
      </span>
    </div>
  );
}
