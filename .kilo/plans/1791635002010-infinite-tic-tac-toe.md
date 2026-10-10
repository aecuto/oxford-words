# Replace HP Battle with Infinite Tic-Tac-Toe

## Goal
Remove the HP/damage battle system entirely and make the win condition an **Infinite Tic-Tac-Toe** board (PvE and PvP): a correct answer earns a mark placement; first 3-in-a-row wins.

## Decided rules
- 3x3 board, **fading marks**: each player keeps max 3 marks; placing a 4th removes their oldest. 3-in-a-row wins; draws impossible from the board.
- Correct answer → **player taps any free cell** to place (X = p1/host, O = p2/guest/bot). Placement happens immediately, while the opponent may still be answering.
- Wrong answer / timeout → no placement, nothing else. SRS grading (`gradeAnswer`, instant/retry) unchanged.
- Words exhausted before a TTT win → **top up, then judge**: solo picks another batch (excluding words already answered this battle); PvP batch 2 is already on the room doc (see below). If still no winner after all words: winner = most correct answers this battle (tie = `draw`).
- Strip ALL HP/damage/streak/crit code (user: "remove all, make more clean code"). The *daily-goal* streak in `wordProgress`/`DailyGoal` is a different feature — keep it.

## Constraints
- Keep routes stable: `/solo`, `/battle/room`, `/result`, `/`. Keep the word pipeline (`pickBattleWords`, `mergeWordLists`, SRS, Firestore collections, `firestore.rules` — no field validation there, schema changes are safe).
- PvP and PvE share one pipeline; no per-mode forks. `src/game/` stays framework-free with short explanatory comments.
- Validation: `pnpm lint` → `npx tsc --noEmit` → `pnpm smoke`.

## New pure module: `src/game/tictactoe.ts`
Framework-free, comment the fade decision:
- `Cell = "" | "X" | "O"`, `Move = { slot: SlotKey; cell: number }`
- `createBoard(): Cell[]` (9 empty)
- `applyPlacement(board, moves, slot, cell)` → `{ board, moves }`: assert cell empty; push move; if that slot now has > `MARKS_PER_PLAYER` marks, clear its oldest cell.
- `checkWinner(board): "X" | "O" | null` — all 8 lines.
- `botPickCell(board, mark): number` — win if possible → block opponent win → center → random corner → random free.
- Add smoke checks in `scripts/smoke-wordPool.ts` for win detection + fade removal (pure, no services).

## Config (`src/lib/gameConfig.ts`)
- Delete: `MAX_HP`, `POPUP_LIFETIME_MS`, `DAMAGE`, `FIRST_ANSWER_BONUS_DAMAGE`, `STREAK_BREAK_BONUS`, `STREAK_BREAK_BONUS_CAP`, `STREAK_FOR_CRIT`, `WRONG_ANSWER_HIT` (+ their comments).
- Keep `HIGH_MS`/`MEDIUM_MS` (TimerBar), timer/word constants, collections.
- Add: `MARKS_PER_PLAYER = 3`, `PLACEMENT_GRACE_MS = 4_000` (PvP settle grace for placements), `WORDS_PER_SOLO_TOPUP` reuse `WORDS_PER_BATTLE`.

## Types (`src/game/types.ts`)
- Delete `Hit`, `Popup`.
- `PlayerSlot`: remove `streak`, `hits` → `{ uid, name, lastAnswer, words }`.
- `RoomDoc`: add `board: Cell[]`, `moves: Move[]`; keep `words/wordIndex/turnStartedAt/players/winner/rematchReady`.

## Delete files
- `src/game/damage.ts`
- `src/app/components/battle/HpBar.tsx`, `DamagePopup.tsx`, `EffectLayer.tsx`

## Bot (`src/game/botBrain.ts`)
- `SoloBotConfig`: drop `hp`, `hit` → `{ name, accuracy, minThinkMs, maxThinkMs }`.
- Delete moods, `pickMood`, `BotBrainInput` HP/streak fields; keep word-length read + jitter think time, hesitations optional (keep — cheap flavor), runner (`schedule`/`lagResolve`/`clear`) unchanged.
- Bot placement: on correct answer, after `botAnswerLagMs()`, call `botPickCell` and place (same flow the player uses).

## Solo store (`src/app/stores/soloBattleStore.ts`)
- Remove: hp fields, streaks, popups, damage imports, KO checks, `playerTimes`/pace feeding.
- State: `board`, `moves`, `pendingPlacement: boolean` (I answered correctly and haven't placed), `myMark = "X"`, `botMark = "O"`.
- Flow per word: player submits → grade (SRS unchanged, keep `wordResults`/`wordMarks`) → if correct `pendingPlacement = true`. Bot answers on its clock → if correct, bot places via `botPickCell` after lag. Advance (after the 900ms settle) requires: my placement done when earned, bot's done when earned → then `wordIndex++` or winner check.
- Winner: after every placement run `checkWinner` → outcome `win`/`lose`. Word exhaustion with no winner → deal another batch (`pickBattleWords(pool, WORDS_PER_BATTLE, stats, wordsAnsweredThisBattle)`), appending to `words`; if the pool is dry, judge: more correct answers wins, tie = `draw`.
- `recordOutcome`/`battleSummary`: drop bestStreak/damageDealt/damageTaken.

## PvP room doc + service (`src/game/roomService.ts`)
- `newSlot` without streak/hits; `createRoom` also stores host words in `players.p1.words` (so batch 2 / rematch have the full host half).
- `startGame`: merge **both full lists** — `mergeWordLists(p1Words, p2Words, p1Words.length + p2Words.length)` — so the room doc carries up to 40 words and batch 2 is just `words[20..40]` (no new top-up write). Raise `MAX_WORDS_PER_ROOM` 30 → 40.
- `submitAnswer(code, key, lastAnswer)` — drop hit/streak/oppHit params.
- New `placeMark(code, slot, cell)`: **transaction** — re-read doc, reject if cell occupied (PvP collision: both players placing simultaneously), apply `applyPlacement`, write `board`+`moves`. Winner detection is read-side (see settle).
- `rematchRoom`: reset `board`/`moves` instead of hits/streaks.
- `endGame` unchanged.

## PvP store (`src/app/stores/roomBattleStore.ts`)
- Remove: `hpLens`/popup diffing, `penaltyHit`, streak tracking, damage imports.
- `buildRoomView`: derive from room doc — `board`, `myMark`/`oppMark` by slot, `pendingPlacement` = my `lastAnswer` correct for current word && I have no move at `moves` for this wordIndex... track placements per word: extend `Move` with `wordIndex` (cleaner: `Move = { slot, cell, wordIndex }`) so pendingPlacement = answered-correct && no own move with this wordIndex.
- `submitPlayer`: same guards, submit `lastAnswer` only.
- New `placeMyMark(cell)` action → `placeMark` transaction; on "occupied" rejection, refresh view and let the player pick again.
- Host `settleTurn` (on each snapshot): 
  - if `checkWinner(board)` → `endGame(winnerByMark)`;
  - else if both answered AND all earned placements placed (or `PLACEMENT_GRACE_MS` passed since the second answer — missed placement forfeits) → if `wordIndex + 1 >= words.length` judge by correct count (`draw` on tie) else `advanceWord`;
  - `deadlineTick`: timeout → submit timeout `lastAnswer` only.

## UI
- `BattleScreen.tsx` → rename `GameScreen.tsx` (`GameScreen`): remove HpBar/DamagePopup/EffectLayer/isCritReady/popups; render the new **`TicTacToeBoard.tsx`** where the HP row was: names + marks above a 3x3 grid, tap free cell when `pendingPlacement` (board disabled otherwise); subtle highlight on each player's oldest mark (the next to fade). Keep timer, word box, AnswerGrid, waiting/"thinking" chips, word progress pips, "View result" flow, sfx hooks.
- `sfx.ts`: remove `hit`/`crit`/`hurt`; add `place` (reuse the `draw` chime URL) and play it on any placement; keep `win`/`lose`/`draw`.
- `result/page.tsx`: stats = Correct / Instant / Accuracy (drop Best streak); modeLine "Solo vs BOT" / "Online vs X". Review-missed-words card stays.
- `battleSummary.ts`: remove `bestStreak`, `damageDealt`, `damageTaken`; `BattleWordDetail` loses `dealt`/`taken`; bump storage key to `battle:summary:v3` and validate loosely.
- `progressService.ts`: `recordResult(outcome)` — remove streak/bestStreak writes; `Progress`/`ProgressDoc` drop `bestStreak` (legacy doc field is harmless).
- `ProgressPanel.tsx`: remove "best streak" chip.
- `solo/page.tsx`, `battle/room/page.tsx`: drop `MAX_HP`/`myMaxHp` props; pass `GameScreen` the new props (`onPlace(cell)`).
- Lobby `page.tsx`: cosmetic only — keep copy mostly, no logic changes.

## Smoke updates (`scripts/smoke-wordPool.ts`)
- PvP merged-set assertion: `merged.length` = size of union capped at 40, still ≥ `WORDS_PER_BATTLE` and duplicate-free (update the `=== WORDS_PER_BATTLE` assertion).
- Add tictactoe checks: win detection (rows/cols/diagonals), fade removal keeps ≤3 marks and always removes the oldest, `botPickCell` returns a free cell and takes a win when available.

## Risks / notes
- PvP double-placement collision is handled by the `placeMark` transaction; loser re-taps. Rare (needs both tapping the same cell within ~RTT).
- If a PvP player never places (network drop), the `PLACEMENT_GRACE_MS` forfeit keeps the game moving.
- Room docs written before this change have no `board`/`moves` — treat missing as empty board (`?? createBoard()`); they can only be in `ended`/`closed` states anyway.
- `pnpm smoke` must still pass unchanged for the word pool (pipeline untouched).

## Validation
1. `pnpm lint`
2. `npx tsc --noEmit`
3. `pnpm smoke` (word pool + new TTT checks)
4. Manual: solo game — answer correctly, place, win/lose; miss → no placement; word exhaustion → top-up; PvP two browser windows — placement syncs, collision re-tap, rematch resets board.
