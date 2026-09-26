import { WRONG_ANSWER_HIT } from "../lib/gameConfig";

// The solo bot lives entirely here: its stat block, its per-word decision
// (mood, accuracy, think time) and its clock (pending answer, natural-fire
// timer, and the lag path when the player answers first). useSoloBattle only
// feeds it context and applies the answers it fires.

export type BotMood = "steady" | "confident" | "pressured" | "desperate";

export type SoloBotConfig = {
  name: string;
  hp: number;
  hit: number;
  accuracy: number;
  minThinkMs: number;
  maxThinkMs: number;
};

// One bot for solo mode. Its think time (shaped by the moods and hesitations
// below) mostly lands under HIGH_MS, so computeHit(thinkMs, streak) usually
// deals top-tier damage with streak crits — it grinds ~6 per word, so the
// player dies around word 17-18 and the only way to win is to out-race it to
// the KO. The race stays winnable because 0.85 accuracy means ~3 misses per
// battle and its misses cost it WRONG_ANSWER_HIT (~15 free HP off the KO
// bar). Answer everything under HIGH_MS and keep the every-4th-answer crit
// alive to KO it by word 16-17; two player misses blow the tempo and the
// race is lost. hp 130 keeps the battle long enough that every word still
// feeds the SRS loop.
export const SOLO_BOT: SoloBotConfig = {
  name: "BOT",
  hp: 130,
  // Its misses cost it exactly what any player's miss costs.
  hit: WRONG_ANSWER_HIT,
  accuracy: 0.85,
  minThinkMs: 900,
  maxThinkMs: 3_400,
};

export type BotBrainInput = {
  config: SoloBotConfig;
  botHpRatio: number;
  playerHpRatio: number;
  botStreak: number;
  playerStreak: number;
  /** Average of the player's last few answer times; null before any answer. */
  playerPaceMs: number | null;
  wordLength: number;
};

export type BotDecision = {
  correct: boolean;
  thinkMs: number;
  mood: BotMood;
};

// One resolved bot answer for a word — the unit the runner fires and the
// battle applies (damage via computeHit(thinkMs, streak) on a hit).
export type PendingBotAnswer = {
  wordIndex: number;
  correct: boolean;
  thinkMs: number;
};

const DESPERATE_HP = 0.35;
const CLEAR_LEAD = 0.15;
const PRESSURED_PACE_MS = 3_000;
const HESITATION_CHANCE = 0.12;

export function decideBotAnswer(input: BotBrainInput): BotDecision {
  const { config } = input;
  const mood = pickMood(input);
  let accuracy = config.accuracy;
  let speed = 1;

  switch (mood) {
    case "desperate":
      // Cornered on HP: rushes the pick and misreads more often.
      accuracy -= 0.12;
      speed = 0.7;
      break;
    case "pressured":
      // The player is outpacing it: hurries and pays with extra misses.
      accuracy -= 0.05;
      speed = 0.8;
      break;
    case "confident":
      // Ahead in the HP race or on a run: settles down and plays precise.
      accuracy += 0.07;
      speed = 1.1;
      break;
  }

  // Longer headwords get a longer read before the pick.
  const readMs = Math.min(input.wordLength, 14) * 35;
  // Two summed randoms make the gaps between answers uneven, not
  // metronome-even — uniform noise is still recognizable as a machine.
  const jitter = (Math.random() + Math.random()) / 2;
  let thinkMs =
    config.minThinkMs + jitter * (config.maxThinkMs - config.minThinkMs);
  thinkMs = thinkMs * speed + readMs;

  // ~1 in 8 words it double-checks itself: a visible pause, then a surer pick.
  const hesitated = Math.random() < HESITATION_CHANCE;
  if (hesitated) {
    thinkMs += 600 + Math.random() * 800;
    accuracy += 0.05;
  }

  // Desperation may dip under the normal floor, but never under a human
  // reaction time; the ceiling only stretches for the hesitation pause.
  const floor = mood === "desperate" ? 600 : config.minThinkMs;
  thinkMs = Math.min(
    Math.max(Math.round(thinkMs), floor),
    config.maxThinkMs + 800
  );

  return { correct: Math.random() < accuracy, thinkMs, mood };
}

function pickMood(input: BotBrainInput): BotMood {
  const behind = input.botHpRatio < input.playerHpRatio - CLEAR_LEAD;
  if (input.botHpRatio <= DESPERATE_HP && behind) return "desperate";
  const outpaced =
    (input.playerPaceMs != null && input.playerPaceMs < PRESSURED_PACE_MS) ||
    input.playerStreak >= 3;
  if (outpaced) return "pressured";
  const cruising =
    input.botStreak >= 4 ||
    input.botHpRatio > input.playerHpRatio + CLEAR_LEAD;
  if (cruising) return "confident";
  return "steady";
}

// When the player answers first, the bot's in-flight decision lands a beat
// later on its own clock — never in the same instant as the player's click.
// The settle gap before the next word is 900ms, so the band stays inside it.
export const BOT_ANSWER_LAG_MS = { min: 450, max: 850 } as const;

export function botAnswerLagMs(): number {
  return (
    BOT_ANSWER_LAG_MS.min +
    Math.random() * (BOT_ANSWER_LAG_MS.max - BOT_ANSWER_LAG_MS.min)
  );
}

// The runner owns the bot's clock: exactly one pending answer per word, a
// natural-fire timer for its think time, and a lag path that lands the
// in-flight answer a beat after the player's. The battle applies fired
// answers via onAnswer; scheduling a new word overwrites the pending one and
// reset/unmount call clear() — so resolution stays exactly-one-per-word.
export type BotRunner = {
  schedule: (wordIndex: number, input: BotBrainInput) => void;
  lagResolve: (wordIndex: number) => void;
  clear: () => void;
};

export function createBotRunner(
  onAnswer: (answer: PendingBotAnswer) => void
): BotRunner {
  let timer: number | null = null;
  let pending: PendingBotAnswer | null = null;

  const clearTimer = () => {
    if (timer != null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  const fire = (p: PendingBotAnswer) => {
    pending = null;
    timer = null;
    onAnswer(p);
  };

  return {
    schedule(wordIndex, input) {
      clearTimer();
      const decision = decideBotAnswer(input);
      pending = {
        wordIndex,
        correct: decision.correct,
        thinkMs: decision.thinkMs,
      };
      timer = window.setTimeout(() => {
        if (!pending || pending.wordIndex !== wordIndex) return;
        fire(pending);
      }, decision.thinkMs);
    },
    lagResolve(wordIndex) {
      // The player resolved the word first: kill the natural timer and let
      // the in-flight decision land a beat later on the bot's own clock.
      clearTimer();
      if (!pending || pending.wordIndex !== wordIndex) return;
      timer = window.setTimeout(() => {
        if (!pending || pending.wordIndex !== wordIndex) return;
        fire(pending);
      }, botAnswerLagMs());
    },
    clear() {
      clearTimer();
      pending = null;
    },
  };
}
