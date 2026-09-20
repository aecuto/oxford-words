const cache = new Map<string, HTMLAudioElement>();

export function playWordAudio(url?: string) {
  if (!url) return;
  let audio = cache.get(url);
  if (!audio) {
    audio = new Audio(url);
    cache.set(url, audio);
  }
  audio.currentTime = 0;
  audio.play().catch(() => {});
}
