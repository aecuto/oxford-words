const SFX_URLS = {
  hit: `https://www.myinstants.com/media/sounds/punch-notification_sound-493565.mp3`,
  crit: `https://www.myinstants.com/media/sounds/extremem-punch.mp3`,
  hurt: `https://www.myinstants.com/media/sounds/minecraft_hit_soundmp3converter.mp3`,
  win: `https://www.myinstants.com/media/sounds/skyrim_level_up_sound_effect_free_downloadx1.mp3`,
  lose: `https://www.myinstants.com/media/sounds/skyrim-skill-level-up.mp3`,
  draw: `https://www.myinstants.com/media/sounds/12_3.mp3`,
} as const;

export type SfxName = keyof typeof SFX_URLS;

const VOLUMES: Record<SfxName, number> = {
  hit: 0.5,
  crit: 0.75,
  hurt: 0.55,
  win: 0.8,
  lose: 0.6,
  draw: 0.45,
};

const MUTED_KEY = "sfxMuted";

let muted = false;
if (typeof window !== "undefined") {
  try {
    muted = window.localStorage.getItem(MUTED_KEY) === "1";
  } catch {}
}

const listeners = new Set<(muted: boolean) => void>();
const cache = new Map<SfxName, HTMLAudioElement>();

export function isSfxMuted(): boolean {
  return muted;
}

export function setSfxMuted(value: boolean): void {
  muted = value;
  try {
    window.localStorage.setItem(MUTED_KEY, value ? "1" : "0");
  } catch {}
  listeners.forEach((notify) => notify(muted));
}

export function onSfxMuteChange(fn: (muted: boolean) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function playSfx(name: SfxName): void {
  if (muted || typeof window === "undefined") return;
  let audio = cache.get(name);
  if (!audio) {
    audio = new Audio(SFX_URLS[name]);
    audio.preload = "auto";
    audio.volume = VOLUMES[name];
    cache.set(name, audio);
  }
  audio.currentTime = 0;
  audio.play().catch(() => {});
}
