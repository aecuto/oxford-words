const SFX_URLS = {
  hit: `https://www.myinstants.com/media/sounds/punch-notification_sound-493565.mp3`,
  crit: `https://www.myinstants.com/media/sounds/extremem-punch.mp3`,
  hurt: `https://www.myinstants.com/media/sounds/bone-crack.mp3`,
  win: `https://www.myinstants.com/media/sounds/award-winners-fanfare.mp3`,
  lose: `https://www.myinstants.com/media/sounds/070-challenge-lose.mp3`,
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

const cache = new Map<SfxName, HTMLAudioElement>();

// Warm the browser cache before the first hit lands: sounds are remote, so
// creating them on first play made the first hit/crit silent-lagged while the
// mp3 downloaded. Call once when the battle screen mounts.
export function preloadSfx(): void {
  if (typeof window === "undefined") return;
  for (const name of Object.keys(SFX_URLS) as SfxName[]) {
    if (cache.has(name)) continue;
    const audio = new Audio(SFX_URLS[name]);
    audio.preload = "auto";
    audio.volume = VOLUMES[name];
    cache.set(name, audio);
    audio.load();
  }
}

export function playSfx(name: SfxName): void {
  if (typeof window === "undefined") return;
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
