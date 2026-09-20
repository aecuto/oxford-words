import type { Hit } from "./types";
import {
  CRIT_MULTIPLIER,
  DAMAGE,
  HIGH_MS,
  MEDIUM_MS,
  MAX_HP,
  STREAK_FOR_CRIT,
  TURN_MS,
} from "../lib/gameConfig";

export type DamageTier = "high" | "medium" | "low";

function tierFor(elapsedMs: number): DamageTier {
  if (elapsedMs <= HIGH_MS) return "high";
  if (elapsedMs <= MEDIUM_MS) return "medium";
  return "low";
}

function isCrit(streakAfter: number): boolean {
  return streakAfter % STREAK_FOR_CRIT === 0;
}

export function computeHit(
  elapsedMs: number,
  streakBefore: number
): { damage: number; crit: boolean } | null {
  if (elapsedMs >= TURN_MS) return null;
  const streakAfter = streakBefore + 1;
  const crit = isCrit(streakAfter);
  const damage = DAMAGE[tierFor(elapsedMs)] * (crit ? CRIT_MULTIPLIER : 1);
  return { damage, crit };
}

export function deriveHp(incomingHits: Hit[]): number {
  return Math.max(0, MAX_HP - incomingHits.reduce((sum, h) => sum + h.damage, 0));
}

export function clampElapsed(ms: number): number {
  return Math.min(Math.max(ms, 0), TURN_MS);
}
