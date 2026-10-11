"use client";

import { cx } from "@emotion/css";
import { PLACEMENT_STREAK } from "../../../lib/gameConfig";

type StreakMeterProps = {
  /** My current consecutive-correct run feeding the next placement. */
  streak: number;
  className?: string;
};

// My 3-segment run tracker: segments fill as the consecutive-correct run
// builds toward the next placement, and a paid-out run starts over empty.
export function StreakMeter({ streak, className }: StreakMeterProps) {
  const filled = streak % PLACEMENT_STREAK;
  return (
    <span
      className={cx("inline-flex items-center gap-1", className)}
      aria-label={`streak ${streak}`}
    >
      {Array.from({ length: PLACEMENT_STREAK }, (_, i) => (
        <span
          key={i}
          className={cx(
            "h-1.5 w-3.5 rounded-full transition-colors",
            i < filled
              ? "bg-blue-500 dark:bg-blue-400"
              : "bg-gray-200 dark:bg-gray-700",
          )}
        />
      ))}
    </span>
  );
}
