import { MARKS_PER_PLAYER, PLACEMENT_STREAK } from "../lib/gameConfig";
import type { Cell, Move, SlotKey } from "./types";

// Infinite Tic-Tac-Toe rules, framework-free so both modes share one
// implementation: PLACEMENT_STREAK consecutive correct answers earn a
// placement on the 3x3 board; a side may hold at most MARKS_PER_PLAYER
// marks — placing one more removes their oldest — and 3 in a row wins.
// Because the oldest mark always fades, the board never fills up and a game
// can only end by a win (or by judging correct-answer counts when the words
// run out, handled by the callers).

const BOARD_CELLS = 9;

// The consecutive-correct run ending just before `upto` (the player's next
// unanswered word) in a per-word result list — anything but `true` breaks
// the run. Both modes build the same per-word result list (PvP from
// correctIdx/wrongIdx, solo from its answers), so one scan serves both.
export function answerStreak(
  results: (boolean | null | undefined)[],
  upto: number,
): number {
  let streak = 0;
  for (let i = upto - 1; i >= 0; i--) {
    if (results[i] !== true) break;
    streak++;
  }
  return streak;
}

// Words whose answer completed a full PLACEMENT_STREAK run — each earns
// exactly one placement, so a longer run pays one per multiple (a 6-streak
// is two placements). A wrong or timed-out word resets the run but never
// erases placements already earned: the returned indexes stay claimable
// until their mark lands on the board.
export function placementWords(
  results: (boolean | null | undefined)[],
): number[] {
  const earned: number[] = [];
  let streak = 0;
  for (let i = 0; i < results.length; i++) {
    if (results[i] === true) {
      streak++;
      if (streak % PLACEMENT_STREAK === 0) earned.push(i);
    } else {
      streak = 0;
    }
  }
  return earned;
}

// Whether THIS answer (at wordIndex, `results` still excluding it) completes
// a full PLACEMENT_STREAK run — the moment a placement is earned. PvP holds
// the next deal on it; solo's settle gate blocks on the same condition via
// placementWords.
export function completesStreak(
  results: (boolean | null | undefined)[],
  wordIndex: number,
  correct: boolean,
): boolean {
  if (!correct) return false;
  return (answerStreak(results, wordIndex) + 1) % PLACEMENT_STREAK === 0;
}

const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const;

export function createBoard(): Cell[] {
  return Array.from({ length: BOARD_CELLS }, () => "" as Cell);
}

export function markFor(slot: SlotKey): Cell {
  return slot === "p1" ? "X" : "O";
}

// Apply one placement: reject an occupied/invalid cell (PvP collisions —
// the loser re-taps), otherwise write the mark and, once the slot would
// exceed its allowance, clear its oldest mark still on the board. The moves
// list keeps the slot's full placement history, so "oldest" is a scan, not
// an index. Pure — callers persist the returned pair.
export function applyPlacement(
  board: Cell[],
  moves: Move[],
  slot: SlotKey,
  cell: number,
  wordIndex: number,
): { board: Cell[]; moves: Move[] } | null {
  if (cell < 0 || cell >= BOARD_CELLS || board[cell] !== "") return null;
  const nextMoves: Move[] = [...moves, { slot, cell, wordIndex }];
  const nextBoard = [...board];
  nextBoard[cell] = markFor(slot);
  const mine = nextMoves.filter((m) => m.slot === slot);
  if (mine.length > MARKS_PER_PLAYER) {
    const oldest = mine.find((m) => nextBoard[m.cell] === markFor(slot));
    if (oldest) nextBoard[oldest.cell] = "";
  }
  return { board: nextBoard, moves: nextMoves };
}

export function checkWinner(board: Cell[]): "X" | "O" | null {
  for (const [a, b, c] of WIN_LINES) {
    const v = board[a];
    if (v !== "" && v === board[b] && v === board[c]) return v;
  }
  return null;
}

// The cell that fades on this slot's next placement (their oldest mark
// still on the board), for the UI's "about to vanish" highlight. Null while
// they hold fewer marks than the allowance.
export function nextToFade(
  board: Cell[],
  moves: Move[],
  slot: SlotKey,
): number | null {
  const mine = moves.filter((m) => m.slot === slot);
  if (mine.length < MARKS_PER_PLAYER) return null;
  const oldest = mine.find((m) => board[m.cell] === markFor(slot));
  return oldest ? oldest.cell : null;
}

// Bot placement, strongest-first: take a win, block the opponent's win,
// otherwise center → random corner → any free cell. Candidates are evaluated
// through applyPlacement (not a naive copy) because placing may fade the
// bot's own oldest mark — a naive check would see wins the fade erases.
export function botPickCell(
  board: Cell[],
  moves: Move[],
  slot: SlotKey,
): number | null {
  const oppSlot: SlotKey = slot === "p1" ? "p2" : "p1";
  const free = board
    .map((c, i) => (c === "" ? i : -1))
    .filter((i) => i >= 0);
  if (!free.length) return null;

  const winsFor = (asSlot: SlotKey, cell: number): boolean => {
    const res = applyPlacement(board, moves, asSlot, cell, -1);
    return res != null && checkWinner(res.board) === markFor(asSlot);
  };

  const win = free.find((cell) => winsFor(slot, cell));
  if (win != null) return win;
  const block = free.find((cell) => winsFor(oppSlot, cell));
  if (block != null) return block;

  if (board[4] === "") return 4;
  const corners = [0, 2, 6, 8].filter((i) => board[i] === "");
  if (corners.length) {
    return corners[Math.floor(Math.random() * corners.length)];
  }
  return free[Math.floor(Math.random() * free.length)];
}
