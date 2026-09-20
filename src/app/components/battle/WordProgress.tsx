"use client";

import { cx } from "@emotion/css";

type WordProgressProps = {
  total: number;
  current: number;
  results?: (boolean | null)[];
};

export function WordProgress({ total, current, results }: WordProgressProps) {
  return (
    <div className="flex-1 flex items-center gap-[3px]" aria-label="word progress">
      {Array.from({ length: total }, (_, i) => {
        const result = results?.[i] ?? null;
        const isCurrent = i === current;
        return (
          <span
            key={i}
            className={cx(
              "h-1.5 flex-1 rounded-full transition-colors",
              result === true
                ? "bg-emerald-500"
                : result === false
                  ? "bg-red-500"
                  : isCurrent
                    ? "bg-blue-500 animate-pulse"
                    : i < current
                      ? "bg-gray-300 dark:bg-gray-600"
                      : "bg-gray-200 dark:bg-gray-700",
              isCurrent && "h-2"
            )}
          />
        );
      })}
    </div>
  );
}
