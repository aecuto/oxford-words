"use client";

import { cx } from "@emotion/css";
import { BoltIcon, ShieldExclamationIcon } from "@heroicons/react/24/solid";
import type { Popup } from "../../../game/types";

type DamagePopupProps = {
  popup: Popup;
  flip?: boolean;
  below?: boolean;
};

const JITTER = [0, 20, 42, 10, 30, 52, 62];

export function DamagePopup({ popup, flip = false, below = false }: DamagePopupProps) {
  const taken = popup.side === "me";
  const offset = 8 + JITTER[Math.floor(popup.id) % JITTER.length];

  return (
    <div
      className={cx(
        "absolute z-20 pointer-events-none select-none",
        below ? "-bottom-10 animate-floatDown" : "-top-10",
        !below && (taken ? "animate-slamDown" : "animate-floatUp"),
      )}
      style={flip ? { right: offset } : { left: offset }}
    >
      <div className="relative flex flex-col items-center">
        {popup.crit && (
          <span className="mb-0.5 text-[10px] sm:text-xs font-black tracking-[0.25em] text-yellow-300 dark:text-yellow-200 drop-shadow-[0_1px_0_rgba(0,0,0,0.6)]">
            CRITICAL
          </span>
        )}
        <div className="flex items-center gap-1">
          {taken ? (
            <span className="flex items-center justify-center w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-red-500 border-2 border-red-300/80 shadow-[0_0_12px_rgba(239,68,68,0.7)]">
              <ShieldExclamationIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
            </span>
          ) : (
            <span className="flex items-center justify-center w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-orange-500 border-2 border-orange-300/80 shadow-[0_0_12px_rgba(249,115,22,0.7)]">
              <BoltIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
            </span>
          )}
          <span
            className={cx(
              "leading-none font-black tabular-nums drop-shadow-[0_2px_0_rgba(0,0,0,0.55)]",
              taken
                ? "text-2xl sm:text-3xl text-red-500 dark:text-red-400"
                : "text-2xl sm:text-3xl text-orange-400 dark:text-orange-300",
              popup.crit && "text-4xl sm:text-5xl",
            )}
          >
            -{popup.damage}
          </span>
        </div>
        {popup.crit && (
          <span className="absolute -inset-3 rounded-full border-2 border-yellow-300/80 animate-critRing pointer-events-none" />
        )}
      </div>
    </div>
  );
}
