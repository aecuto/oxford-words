// The solo bot lives entirely here: its stat block, its per-word decision
// (accuracy, think time) and its clock (pending answer, natural-fire timer,
// and the lag path when the player answers first). useSoloBattle only feeds
// it context and applies the answers it fires; board placement is chosen by
// botPickCell in tictactoe.ts.

export type SoloBotConfig = {
  name: string;
  accuracy: number;
  minThinkMs: number;
  maxThinkMs: number;
};

// One bot for solo mode. Its think time races the player per word: whoever
// commits first places their mark first, and the think time shapes how much
// answer feedback the player sees before the bot's mark lands. At 0.85
// accuracy it misses often enough that a strong player out-places it on the
// board.
export const SOLO_BOT: SoloBotConfig = {
  name: "BOT",
  accuracy: 0.85,
  minThinkMs: 900,
  maxThinkMs: 3_400,
};

export type BotBrainInput = {
  config: SoloBotConfig;
  wordLength: number;
};

type BotDecision = {
  correct: boolean;
  thinkMs: number;
};

// One resolved bot answer for a word — the unit the runner fires and the
// battle applies (a correct answer becomes a board placement).
export type PendingBotAnswer = {
  wordIndex: number;
  correct: boolean;
  thinkMs: number;
};

const HESITATION_CHANCE = 0.12;

export function decideBotAnswer(input: BotBrainInput): BotDecision {
  const { config } = input;
  let accuracy = config.accuracy;

  // Longer headwords get a longer read before the pick.
  const readMs = Math.min(input.wordLength, 14) * 35;
  // Two summed randoms make the gaps between answers uneven, not
  // metronome-even — uniform noise is still recognizable as a machine.
  const jitter = (Math.random() + Math.random()) / 2;
  let thinkMs =
    config.minThinkMs + jitter * (config.maxThinkMs - config.minThinkMs);
  thinkMs += readMs;

  // ~1 in 8 words it double-checks itself: a visible pause, then a surer pick.
  const hesitated = Math.random() < HESITATION_CHANCE;
  if (hesitated) {
    thinkMs += 600 + Math.random() * 800;
    accuracy += 0.05;
  }

  // The floor stays at the config minimum (a human reaction time); the
  // ceiling only stretches for the hesitation pause.
  thinkMs = Math.min(
    Math.max(Math.round(thinkMs), config.minThinkMs),
    config.maxThinkMs + 800
  );

  return { correct: Math.random() < accuracy, thinkMs };
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
