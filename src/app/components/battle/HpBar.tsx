"use client";

import { useEffect, useState } from "react";
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
  const low = ratio <= 0.2 && hp > 0;
  const [ghostRatio, setGhostRatio] = useState(ratio);

  useEffect(() => {
    if (ratio >= ghostRatio) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot: snap ghost bar forward when hp recovers */
      setGhostRatio(ratio);
      return;
    }
    const t = window.setTimeout(() => setGhostRatio(ratio), 350);
    return () => window.clearTimeout(t);
  }, [ratio, ghostRatio]);

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
      <div
        className={cx(
          "relative h-4 rounded-full border border-gray-800 dark:border-gray-300 bg-gray-300 dark:bg-gray-700 overflow-hidden transition-shadow",
          low && "shadow-[0_0_10px_rgba(239,68,68,0.6)]"
        )}
      >
        <div className={cx("absolute inset-0 flex", flip && "justify-end")}>
          <div
            className="h-full bg-white/80 transition-all duration-500 ease-out"
            style={{ width: `${ghostRatio * 100}%` }}
          />
        </div>
        <div className={cx("absolute inset-0 flex", flip && "justify-end")}>
          <div
            className={cx("h-full transition-all duration-200 ease-out", barColor(ratio))}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
