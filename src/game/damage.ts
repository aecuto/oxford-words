import type { Hit } from "./types";
import {
  ANSWER_INSTANT_MS,
  DAMAGE,
  DAMAGE_SPEED_MULTIPLIERS,
  HIGH_MS,
  MAX_HP,
  MEDIUM_MS,
  STREAK_FOR_CRIT,
  TURN_MS,
} from "../lib/gameConfig";

export const CRIT_PERIOD = STREAK_FOR_CRIT + 1;

function isCrit(streakAfter: number): boolean {
  return streakAfter > 0 && streakAfter % CRIT_PERIOD === 0;
}

export function isCritReady(streak: number): boolean {
  return streak > 0 && streak % CRIT_PERIOD === STREAK_FOR_CRIT;
}

// Speed tier of a hit: under 2s (the SRS instant mark) deals 1.5x, under 4s
// (TimerBar green) 1.25x, under 7s (amber) the base 1x, and stalling in the
// red only 0.75x — ask fast, hit hard.
export function speedMultiplier(elapsedMs: number): number {
  if (elapsedMs < ANSWER_INSTANT_MS) return DAMAGE_SPEED_MULTIPLIERS.instant;
  if (elapsedMs < HIGH_MS) return DAMAGE_SPEED_MULTIPLIERS.fast;
  if (elapsedMs < MEDIUM_MS) return DAMAGE_SPEED_MULTIPLIERS.normal;
  return DAMAGE_SPEED_MULTIPLIERS.slow;
}

export function computeHit(
  elapsedMs: number,
  streakBefore: number,
): { damage: number; crit: boolean } | null {
  if (elapsedMs >= TURN_MS) return null;
  // Escalating streak damage: the streak position picks 3/4/5/8 and the top
  // of the cycle is the crit, so damage and the crit flag always agree. The
  // speed tier then scales the base, so a fast crit hits far harder than a
  // slow one — and the KO point moves with speed instead of pinning to
  // word 20.
  const streakAfter = streakBefore + 1;
  const crit = isCrit(streakAfter);
  const base = DAMAGE[(streakAfter - 1) % CRIT_PERIOD];
  const damage = Math.max(1, Math.round(base * speedMultiplier(elapsedMs)));
  return { damage, crit };
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
