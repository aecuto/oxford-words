"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@emotion/css";
import { CursorArrowRaysIcon, FlagIcon } from "@heroicons/react/24/solid";
import type { BattleView } from "../../stores/roomBattleStore";
import { PLACEMENT_STREAK } from "../../../lib/gameConfig";
import { playSfx, preloadSfx } from "../../../lib/sfx";
import { preloadWordAudio } from "../../playWordAudio";
import { AnswerGrid } from "./AnswerGrid";
import { Logo } from "../Logo";
import { StreakMeter } from "./StreakMeter";
import { TicTacToeBoard } from "./TicTacToeBoard";
import { WordPlayBox } from "./WordPlayBox";
import { WordProgress } from "./WordProgress";

type GameScreenProps = {
  view: BattleView;
  onAnswer: (answer: string | null) => void;
  onPlace: (cell: number) => void;
  onPlayWord: () => void;
  onViewResult: () => void;
  /** Offered on the PvP finish panel (my list is done, opponent isn't). */
  onExit?: () => void;
};

export function GameScreen({
  view,
  onAnswer,
  onPlace,
  onPlayWord,
  onViewResult,
  onExit,
}: GameScreenProps) {
  const ended = view.outcome !== null;

  const [playedWordNumber, setPlayedWordNumber] = useState<number | null>(null);
  const soundUnlocked = playedWordNumber === view.wordNumber;

  const handlePlayWord = () => {
    onPlayWord();
    setPlayedWordNumber(view.wordNumber);
  };

  const handleViewResult = () => {
    if (view.outcome) playSfx(view.outcome);
    onViewResult();
  };

  // One chime per placement, whichever side placed it.
  const seenMoves = useRef<number>(-1);
  useEffect(() => {
    const count = view.moves.length;
    if (seenMoves.current === -1) {
      seenMoves.current = count;
      return;
    }
    if (count > seenMoves.current) {
      seenMoves.current = count;
      playSfx("place");
    }
  }, [view.moves.length]);

  const viewResultButton = (
    <button
      onClick={handleViewResult}
      className="animate-popIn inline-flex items-center gap-2 rounded-full bg-indigo-600 px-6 py-3 text-sm sm:text-base font-black text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 active:scale-95 transition-all touch-manipulation select-none"
    >
      <FlagIcon className="w-5 h-5" />
      View result
    </button>
  );

  // Preload audio off the interaction path: game SFX once on mount, and the
  // current word's pronunciation whenever the word changes.
  useEffect(() => {
    preloadSfx();
  }, []);

  useEffect(() => {
    preloadWordAudio(view.word?.pronounceURL);
  }, [view.word?.pronounceURL]);

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-screen-md flex-col p-4 sm:p-6 select-none">
      <Logo size="sm" className="mb-2" />

      {/* Word HUD — top */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-xs font-bold tabular-nums text-gray-500 dark:text-gray-400 shrink-0">
          {view.wordNumber} / {view.wordTotal}
        </span>
        <WordProgress
          total={view.wordTotal}
          current={view.wordNumber - 1}
          results={view.wordResults}
          marks={view.wordMarks}
        />
      </div>

      {/* Board — the Infinite Tic-Tac-Toe scoreline both players play on */}
      <div className="mt-2 mb-3">
        <div className="flex items-center justify-between gap-2 mb-1.5 px-1 max-w-[300px] sm:max-w-[340px] mx-auto">
          <span className="flex items-center gap-1.5 min-w-0 text-sm font-bold text-gray-700 dark:text-gray-200 truncate">
            <span className="font-black text-blue-500 dark:text-blue-400">
              {view.myMark}
            </span>
            <span className="truncate">{view.myName}</span>
          </span>
          <span className="shrink-0 text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 text-center leading-tight">
            3 in a row
            <br />
            to place
          </span>
          <span className="flex items-center gap-1.5 min-w-0 text-sm font-bold text-gray-700 dark:text-gray-200 truncate justify-end">
            <span className="truncate">{view.oppName}</span>
            <span className="font-black text-rose-500 dark:text-rose-400">
              {view.oppMark}
            </span>
          </span>
        </div>
        <TicTacToeBoard
          board={view.board}
          myMark={view.myMark}
          myNextFade={view.myNextFade}
          oppNextFade={view.oppNextFade}
          canPlace={view.pendingPlacement}
          onPlace={onPlace}
        />
        {view.pendingPlacement && (
          <p className="animate-popIn mt-2 flex items-center justify-center gap-1.5 text-center text-xs sm:text-sm font-bold text-blue-600 dark:text-blue-400">
            <CursorArrowRaysIcon className="w-4 h-4 shrink-0 animate-bounce" />
            Correct! Tap a cell to place your {view.myMark} — the next word
            deals after
          </p>
        )}
      </div>

      {/* Streak bar — my run toward the next placement, directly above the
          word box. The reserved height keeps the layout from jumping when
          the bar appears on the first correct answer. */}
      {!ended && !view.pendingPlacement && view.myStreak > 0 && (
        <div className="mb-2 flex min-h-7 items-center justify-center">
          <span className="inline-flex items-center gap-2 animate-popIn text-xs sm:text-sm font-semibold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-full px-3 py-1">
            <StreakMeter streak={view.myStreak} />
            {PLACEMENT_STREAK - (view.myStreak % PLACEMENT_STREAK)} more
            correct in a row to place your {view.myMark}
          </span>
        </div>
      )}

      {/* Word box — tap to play the sound; the word and answers appear inside.
          Once the game ends, it is replaced by the view result box; a PvP
          player who has answered their whole list sees the finish panel. */}
      {ended ? (
        <div className="flex justify-center">{viewResultButton}</div>
      ) : view.word ? (
        <WordPlayBox
          word={view.word}
          played={soundUnlocked}
          onTap={handlePlayWord}
        >
          {soundUnlocked && (
            <AnswerGrid
              word={view.word}
              selected={view.selected}
              answerState={view.answerState}
              disabled={view.answerState !== "idle"}
              onSelect={(answer) => {
                onAnswer(answer);
              }}
            />
          )}
        </WordPlayBox>
      ) : (
        <div className="animate-popIn mx-auto max-w-sm rounded-xl border-2 border-gray-300/60 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 text-center">
          <p className="text-lg font-black mb-1">All words answered</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Waiting for {view.oppName} to finish — if nobody scores 3 in a
            row, the game ends in a draw.
          </p>
          {view.pendingPlacement && (
            <p className="mt-2 text-xs font-bold text-blue-600 dark:text-blue-400">
              You can still place your earned {view.myMark} above.
            </p>
          )}
          {onExit && (
            <button
              onClick={onExit}
              className="mt-4 text-xs font-semibold text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors touch-manipulation"
            >
              Back to lobby
            </button>
          )}
        </div>
      )}

      {/* Status chips — PvP: my latest miss reveals the right answer; solo:
          the bot is mid-thought, so its deliberation stays visible. */}
      <div className="mb-2 flex flex-wrap items-center justify-center gap-2 min-h-7">
        {view.feedback && !ended && (
          <span
            className={cx(
              "inline-flex items-center gap-1.5 animate-popIn text-xs sm:text-sm font-semibold",
              "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40",
              "rounded-full px-3 py-1 border border-amber-200 dark:border-amber-800",
            )}
          >
            Missed — answer:
            <span className="font-bold text-sm sm:text-base leading-relaxed">
              {view.feedback.answer}
            </span>
          </span>
        )}
        {view.oppThinking && !ended && (
          <span className="inline-flex items-center gap-2 animate-popIn text-xs sm:text-sm font-semibold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-full px-3 py-1">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
            </span>
            {view.oppName} is thinking
            <span className="inline-flex items-end gap-0.5" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1 w-1 rounded-full bg-blue-400 animate-bounce"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
