"use client";

import { cx } from "@emotion/css";
import { HIGH_MS, MEDIUM_MS } from "../../../lib/gameConfig";

type TimerBarProps = {
  remainingMs: number;
  totalMs: number;
};

export function TimerBar({ remainingMs, totalMs }: TimerBarProps) {
  const ratio = Math.max(0, Math.min(1, remainingMs / totalMs));
  const seconds = Math.ceil(remainingMs / 1000);
  const zone: "fast" | "mid" | "slow" =
    remainingMs > totalMs - HIGH_MS
      ? "fast"
      : remainingMs > totalMs - MEDIUM_MS
        ? "mid"
        : "slow";
  const marks = [
    ((totalMs - HIGH_MS) / totalMs) * 100,
    ((totalMs - MEDIUM_MS) / totalMs) * 100,
  ];
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-1 h-3 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden border border-gray-300 dark:border-gray-600">
        <div
          className={cx(
            "h-full rounded-full transition-colors",
            zone === "fast"
              ? "bg-emerald-500"
              : zone === "mid"
                ? "bg-amber-500"
                : "bg-red-500 animate-pulse"
          )}
          style={{ width: `${ratio * 100}%` }}
        />
        {marks.map((left) => (
          <span
            key={left}
            className="absolute top-0 h-full w-0.5 bg-gray-900/25 dark:bg-white/25"
            style={{ left: `${left}%` }}
          />
        ))}
      </div>
      <span
        className={cx(
          "w-8 text-center font-mono font-black text-lg tabular-nums",
          zone === "slow" && "text-red-500"
        )}
      >
        {seconds}
      </span>
    </div>
  );
}
