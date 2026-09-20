export const MAX_HP = 100;

export const TURN_MS = 10_000;
export const TURN_GRACE_MS = 1_500;

export const WORDS_PER_BATTLE = 20;
export const MAX_WORDS_PER_ROOM = 30;

export const DAILY_GOAL_CORRECT = WORDS_PER_BATTLE;

export const WORD_SOUND_DELAY_MS = 300;
export const POPUP_LIFETIME_MS = 1_100;

export const DAMAGE = {
  high: 6,
  medium: 5,
  low: 4,
} as const;

export const CRIT_MULTIPLIER = 2;
export const STREAK_FOR_CRIT = 5;

export const SOLO_BOT = {
  name: "BOT",
  hp: 120,
  hit: 10,
} as const;

export const COLLECTION = "oxfordwords_rooms";
export const PROGRESS_COLLECTION = "oxfordwords_progress";

export const ROOM_CODE_LEN = 4;
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const HIGH_MS = 4_000;
export const MEDIUM_MS = 7_000;
