"use client";

import { cx } from "@emotion/css";
import type { Cell } from "../../../game/types";

type TicTacToeBoardProps = {
  board: Cell[];
  myMark: Cell;
  /** Cells that fade on that side's next placement — the vanishing hint. */
  myNextFade: number | null;
  oppNextFade: number | null;
  /** True while I've earned a placement and haven't tapped a cell. */
  canPlace: boolean;
  onPlace: (cell: number) => void;
};

// The shared Infinite Tic-Tac-Toe board. Free cells light up while a
// placement is earned; each side's oldest mark pulses once it is the one
// that would fade, so the fading rule is readable at a glance.
export function TicTacToeBoard({
  board,
  myMark,
  myNextFade,
  oppNextFade,
  canPlace,
  onPlace,
}: TicTacToeBoardProps) {
  return (
    <div
      className="grid grid-cols-3 gap-1.5 sm:gap-2 w-full max-w-[260px] sm:max-w-[300px] mx-auto select-none touch-manipulation"
      aria-label="tic tac toe board"
    >
      {board.map((cell, i) => {
        const placing = canPlace && cell === "";
        const fading = i === myNextFade || i === oppNextFade;
        return (
          <button
            key={i}
            type="button"
            onClick={() => placing && onPlace(i)}
            disabled={!placing}
            aria-label={
              cell
                ? `cell ${i + 1}: ${cell}`
                : placing
                  ? `cell ${i + 1}: place ${myMark}`
                  : `cell ${i + 1}: empty`
            }
            className={cx(
              "aspect-square rounded-xl border-2 flex items-center justify-center",
              "text-4xl sm:text-5xl font-black transition-all",
              cell === ""
                ? "border-gray-300/60 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/40"
                : "border-gray-400/40 dark:border-gray-600 bg-white dark:bg-gray-800",
              placing &&
                "cursor-pointer border-blue-500 bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/60 active:scale-95 shadow-lg shadow-blue-500/20",
              fading && "animate-pulse opacity-60",
            )}
          >
            {cell !== "" && (
              <span
                className={cx(
                  "animate-popIn leading-none",
                  cell === "X"
                    ? "text-blue-500 dark:text-blue-400"
                    : "text-rose-500 dark:text-rose-400",
                )}
              >
                {cell}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
