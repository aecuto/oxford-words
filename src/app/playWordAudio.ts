const cache = new Map<string, HTMLAudioElement>();

// Fetch the pronunciation in the background as soon as the word shows up, so
// tapping to play is instant instead of waiting on the network.
export function preloadWordAudio(url?: string) {
  if (!url || cache.has(url)) return;
  const audio = new Audio(url);
  audio.preload = "auto";
  cache.set(url, audio);
  audio.load();
}

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
