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
          "flex items-center gap-1.5 sm:gap-2 mb-1 text-xs sm:text-sm",
          flip && "flex-row-reverse"
        )}
      >
        <span className="font-bold truncate max-w-[40%] sm:max-w-[50%]">
          {name}
        </span>
        <span
          className={cx(
            "text-xs font-black px-1.5 py-0.5 rounded",
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
          <span className="text-[10px] font-black tracking-widest text-yellow-500 dark:text-yellow-300">
            CRIT
          </span>
        )}
        <span className="ml-auto text-[10px] font-bold tabular-nums text-gray-400 dark:text-gray-500">
          {hp}/{max}
        </span>
      </div>
      <div
        className={cx(
          "relative h-4 rounded-full border bg-gray-300 dark:bg-gray-700 overflow-hidden",
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
      </div>
    </div>
  );
}
