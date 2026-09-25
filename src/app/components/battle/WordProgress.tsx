"use client";

import { cx } from "@emotion/css";

type WordProgressProps = {
  total: number;
  current: number;
  results?: (boolean | null)[];
  /** Per-word instant grade (true = <2s). Solo battles pass it; PvP omits
   * it, and correct answers without a grade stay emerald. */
  marks?: (boolean | null)[];
};

// One pip per battle word. With timing data (solo) the 2-option rule is
// visible: emerald = instant/mastered, amber = correct but slow (graded
// retry, stays in Pool B), red = wrong or timed out.
export function WordProgress({ total, current, results, marks }: WordProgressProps) {
  return (
    <div className="flex-1 flex items-center gap-[3px]" aria-label="word progress">
      {Array.from({ length: total }, (_, i) => {
        const result = results?.[i] ?? null;
        const isCurrent = i === current;
        const color =
          result === true
            ? marks != null && marks[i] === false
              ? "bg-amber-500"
              : "bg-emerald-500"
            : result === false
              ? "bg-red-500"
              : isCurrent
                ? "bg-blue-500 animate-pulse"
                : i < current
                  ? "bg-gray-300 dark:bg-gray-600"
                  : "bg-gray-200 dark:bg-gray-700";
        return (
          <span
            key={i}
            className={cx(
              "h-1.5 flex-1 rounded-full transition-colors",
              color,
              isCurrent && "h-2"
            )}
          />
        );
      })}
    </div>
  );
}
