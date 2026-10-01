import type { Hit } from "./types";
import {
  DAMAGE,
  FIRST_ANSWER_BONUS_DAMAGE,
  MAX_HP,
  STREAK_BREAK_BONUS,
  STREAK_BREAK_BONUS_CAP,
  STREAK_FOR_CRIT,
  TURN_MS,
  WRONG_ANSWER_HIT,
} from "../lib/gameConfig";

export const CRIT_PERIOD = STREAK_FOR_CRIT + 1;

function isCrit(streakAfter: number): boolean {
  return streakAfter > 0 && streakAfter % CRIT_PERIOD === 0;
}

export function isCritReady(streak: number): boolean {
  return streak > 0 && streak % CRIT_PERIOD === STREAK_FOR_CRIT;
}

export function computeHit(
  elapsedMs: number,
  streakBefore: number,
  firstAnswer = false,
): { damage: number; crit: boolean } | null {
  if (elapsedMs >= TURN_MS) return null;
  // Escalating streak damage: the streak position picks 3/4/5/8 and the top
  // of the cycle is the crit, so damage and the crit flag always agree.
  // Whoever answered the word first adds the race bonus to their hit.
  const streakAfter = streakBefore + 1;
  const crit = isCrit(streakAfter);
  const damage =
    DAMAGE[(streakAfter - 1) % CRIT_PERIOD] +
    (firstAnswer ? FIRST_ANSWER_BONUS_DAMAGE : 0);
  return { damage, crit };
}

// Penalty hit a wrong answer feeds the opponent: the base price plus a bonus
// scaled by the correct streak the miss breaks — wrong after a long run
// hurts most.
export function streakBreakPenalty(brokenStreak: number): number {
  const capped = Math.min(Math.max(brokenStreak, 0), STREAK_BREAK_BONUS_CAP);
  return WRONG_ANSWER_HIT + capped * STREAK_BREAK_BONUS;
}

export function deriveHp(incomingHits: Hit[]): number {
  return Math.max(
    0,
    MAX_HP - incomingHits.reduce((sum, h) => sum + h.damage, 0),
  );
}

export function clampElapsed(ms: number): number {
  return Math.min(Math.max(ms, 0), TURN_MS);
}
