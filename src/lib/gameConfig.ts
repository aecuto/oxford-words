export const MAX_HP = 100;

export const TURN_MS = 10_000;
export const TURN_GRACE_MS = 1_500;

export const WORDS_PER_BATTLE = 20;
export const MAX_WORDS_PER_ROOM = 30;

export const WORD_SOUND_DELAY_MS = 300;

export const DAMAGE = {
  high: 40,
  medium: 25,
  low: 12,
} as const;

export const CRIT_MULTIPLIER = 2;
export const STREAK_FOR_CRIT = 3;

export const SOLO_BOSS = {
  name: "WORD BOSS",
  hp: 300,
  hit: 15,
} as const;

export const COLLECTION = "oxfordwords_rooms";
export const PROGRESS_COLLECTION = "oxfordwords_progress";

export const ROOM_CODE_LEN = 4;
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const HIGH_MS = 3_000;
export const MEDIUM_MS = 7_000;
