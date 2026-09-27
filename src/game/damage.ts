import type { Hit } from "./types";
import { DAMAGE, MAX_HP, STREAK_FOR_CRIT, TURN_MS } from "../lib/gameConfig";

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
): { damage: number; crit: boolean } | null {
  if (elapsedMs >= TURN_MS) return null;
  // Escalating streak damage: the streak position picks 3/4/5/8 and the top
  // of the cycle is the crit, so damage and the crit flag always agree.
  // Speed only gates whether the hit lands at all (deadline check above) —
  // any per-speed scaling would drift the KO point off word 20.
  const streakAfter = streakBefore + 1;
  const crit = isCrit(streakAfter);
  const damage = DAMAGE[(streakAfter - 1) % CRIT_PERIOD];
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
