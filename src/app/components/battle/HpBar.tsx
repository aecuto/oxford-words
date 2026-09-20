"use client";

import { cx } from "@emotion/css";

type HpBarProps = {
  name: string;
  hp: number;
  max: number;
  streak: number;
  flip?: boolean;
};

function barColor(ratio: number): string {
  if (ratio > 0.5) return "bg-gradient-to-b from-emerald-400 to-emerald-600";
  if (ratio > 0.2) return "bg-gradient-to-b from-amber-300 to-amber-500";
  return "bg-gradient-to-b from-red-400 to-red-600 animate-pulse";
}

export function HpBar({ name, hp, max, streak, flip = false }: HpBarProps) {
  const ratio = Math.max(0, Math.min(1, hp / max));
  return (
    <div className="flex-1 min-w-0">
      <div
        className={cx(
          "flex items-center gap-2 mb-1 text-sm",
          flip && "flex-row-reverse"
        )}
      >
        <span className="font-bold truncate max-w-[55%]">{name}</span>
        <span
          className={cx(
            "text-xs font-black px-1.5 py-0.5 rounded",
            streak >= 3
              ? "bg-orange-500 text-white animate-pulse"
              : "bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
          )}
        >
          x{streak}
        </span>
        <span
          className={cx(
            "text-xs font-mono text-gray-500 dark:text-gray-400",
            flip ? "mr-auto" : "ml-auto"
          )}
        >
          {hp}/{max}
        </span>
      </div>
      <div className="relative h-5 rounded-md border-2 border-gray-800 dark:border-gray-300 bg-gray-300 dark:bg-gray-700 overflow-hidden shadow-inner">
        <div
          className={cx(
            "absolute inset-y-0 flex",
            flip && "justify-end"
          )}
        >
          <div
            className={cx(
              "h-full transition-all duration-500 ease-out",
              barColor(ratio)
            )}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
