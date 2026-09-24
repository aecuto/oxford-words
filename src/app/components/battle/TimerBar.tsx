"use client";

import { useEffect, useState } from "react";
import { cx } from "@emotion/css";
import { HIGH_MS, MEDIUM_MS } from "../../../lib/gameConfig";

type TimerBarProps = {
  startedAt: number | null;
  totalMs: number;
};

export function TimerBar({ startedAt, totalMs }: TimerBarProps) {
  // The tick lives here on purpose: state updates 10x/sec, so keeping the
  // countdown in the battle hook re-rendered the whole screen at that rate.
  // Only the seconds label and zone color still re-render; the bar itself is
  // a pure CSS animation (timerDrain) interpolated at display refresh rate.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) return;
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- sync the label to the new turn's start instead of waiting for the first tick */
    setNow(Date.now());
    // 10 ticks/sec is plenty for the label; a rAF loop re-rendered
    // ~60x/sec for no visible difference.
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [startedAt]);

  const remainingMs =
    startedAt === null ? totalMs : Math.max(0, totalMs - (now - startedAt));
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
        {/* key restarts the drain animation at 100% for each new turn */}
        <div
          key={startedAt ?? "idle"}
          className={cx(
            "h-full w-full origin-left rounded-full transition-colors",
            zone === "fast"
              ? "bg-emerald-500"
              : zone === "mid"
                ? "bg-amber-500"
                : "bg-red-500 animate-pulse"
          )}
          style={
            startedAt === null
              ? undefined
              : { animation: `timerDrain ${totalMs}ms linear forwards` }
          }
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
