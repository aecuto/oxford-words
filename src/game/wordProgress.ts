export type WordStat = {
  seen: number;
  correct: number;
  wrong: number;
  lastSeenAt: number;
};

export type WordStats = Record<string, WordStat>;

export type WordResult = { word: string; correct: boolean };

const KEY = "solo:wordStats:v1";

export function loadWordStats(): WordStats {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as WordStats) : {};
  } catch {
    return {};
  }
}

export function saveWordResults(results: WordResult[]): WordStats {
  const stats = loadWordStats();
  const now = Date.now();
  for (const r of results) {
    const prev = stats[r.word] ?? {
      seen: 0,
      correct: 0,
      wrong: 0,
      lastSeenAt: 0,
    };
    stats[r.word] = {
      seen: prev.seen + 1,
      correct: prev.correct + (r.correct ? 1 : 0),
      wrong: prev.wrong + (r.correct ? 0 : 1),
      lastSeenAt: now,
    };
  }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(stats));
  } catch {
    // storage unavailable; keep in-memory stats for this session
  }
  return stats;
}
