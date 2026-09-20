"use client";

import { cx } from "@emotion/css";
import { isCritReady } from "../../../game/damage";

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
  return "bg-gradient-to-b from-red-400 to-red-600";
}

export function HpBar({ name, hp, max, streak, flip = false }: HpBarProps) {
  const ratio = Math.max(0, Math.min(1, hp / max));
  const low = ratio <= 0.2 && hp > 0;
  const charged = isCritReady(streak);

  return (
    <div className="flex-1 min-w-0">
      <div
        className={cx(
          "flex items-center gap-2 sm:gap-2.5 mb-1.5 text-sm sm:text-base",
          flip && "flex-row-reverse"
        )}
      >
        <span className="font-extrabold text-gray-900 dark:text-gray-100 truncate max-w-[45%] sm:max-w-[50%] tracking-wide">
          {name}
        </span>
        <span
          className={cx(
            "text-xs sm:text-sm font-black px-1.5 sm:px-2 py-0.5 rounded-md",
            charged
              ? "bg-yellow-400 text-yellow-950"
              : streak >= 1
                ? "bg-orange-500 text-white"
                : "bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
          )}
        >
          x{streak}
        </span>
        {charged && (
          <span className="text-[10px] sm:text-xs font-black tracking-widest text-yellow-500 dark:text-yellow-300">
            CRIT
          </span>
        )}
      </div>
      <div
        className={cx(
          "relative h-6 sm:h-7 rounded-full border-2 bg-gray-200 dark:bg-gray-800 overflow-hidden",
          charged
            ? "border-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.45)]"
            : "border-gray-800 dark:border-gray-300",
          low && !charged && "shadow-[0_0_10px_rgba(239,68,68,0.6)]"
        )}
      >
        <div className={cx("absolute inset-0 flex", flip && "justify-end")}>
          <div
            className={cx("h-full", barColor(ratio))}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
        <div className="absolute inset-x-0 top-0 h-1/2 rounded-t-full bg-white/20 pointer-events-none" />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span
            className={cx(
              "text-[11px] sm:text-xs font-black tabular-nums tracking-wide text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]",
              low && "animate-pulse"
            )}
          >
            {hp}/{max}
          </span>
        </div>
      </div>
    </div>
  );
}
