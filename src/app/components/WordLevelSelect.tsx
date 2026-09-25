"use client";

import type { WordLevel } from "../../lib/gameConfig";

const LEVELS: { value: WordLevel; label: string; hint: string }[] = [
  { value: "3000", label: "3000", hint: "Oxford 3000 — the core words only" },
  { value: "5000", label: "5000", hint: "Oxford 5000 — advanced words only" },
];

// Segmented 3000/5000 toggle. Controlled: the page owns the state so other
// panels (e.g. the progress totals) can react to a switch in the same render.
export function WordLevelSelect({
  value,
  onChange,
}: {
  value: WordLevel;
  onChange: (level: WordLevel) => void;
}) {
  const active = LEVELS.find((l) => l.value === value) ?? LEVELS[0];
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-gray-800/60 border border-gray-800 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-400">
          Word list
        </p>
        <p className="text-[10px] text-gray-500 truncate">{active.hint}</p>
      </div>
      <div
        role="group"
        aria-label="Word list level"
        className="flex shrink-0 rounded-lg overflow-hidden border border-gray-700"
      >
        {LEVELS.map((l) => {
          const isActive = l.value === value;
          return (
            <button
              key={l.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => onChange(l.value)}
              className={
                isActive
                  ? "px-4 py-2 text-sm font-black bg-blue-500 text-white"
                  : "px-4 py-2 text-sm font-bold bg-gray-800/60 text-gray-400 hover:text-white transition-colors"
              }
            >
              {l.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
