import { sample } from "lodash";

export const CORRECT_FEEDBACK = [
  "Nice hit!",
  "Sharp!",
  "Clean strike!",
  "Brain power!",
  "You're on fire!",
  "Slick!",
];

export const CRIT_FEEDBACK = [
  "CRITICAL!",
  "UNSTOPPABLE!",
  "MEGA HIT!",
  "DEVASTATING!",
  "ABSOLUTE CINEMA!",
];

export const WRONG_FEEDBACK = [
  "Ouch!",
  "Missed!",
  "So close...",
  "The word fights back!",
  "Shake it off!",
];

export const TIMEOUT_FEEDBACK = [
  "Too slow!",
  "Time's up!",
  "The clock wins!",
  "Frozen solid!",
];

export type Feedback = {
  text: string;
  tone: "good" | "bad";
  crit: boolean;
  damage: number;
};

export function feedbackFor(
  result: "correct" | "wrong" | "timeout",
  crit: boolean,
  damage = 0
): Feedback {
  if (result === "correct") {
    return crit
      ? { text: sample(CRIT_FEEDBACK)!, tone: "good", crit: true, damage }
      : { text: sample(CORRECT_FEEDBACK)!, tone: "good", crit: false, damage };
  }
  return result === "timeout"
    ? { text: sample(TIMEOUT_FEEDBACK)!, tone: "bad", crit: false, damage }
    : { text: sample(WRONG_FEEDBACK)!, tone: "bad", crit: false, damage };
}
