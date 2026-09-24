import { DAILY_GOAL_CORRECT } from "../lib/gameConfig";

export type WordStat = {
  seen: number;
  correct: number;
  wrong: number;
  lastSeenAt: number;
  ivl: number;
};

export type WordStats = Record<string, WordStat>;

export type WordResult = { word: string; correct: boolean };

export type DailyProgress = {
  date: string;
  correct: number;
  met: boolean;
  streak: number;
  correctWords?: string[];
};

const KEY = "solo:wordStats:v1";
const DAILY_KEY = "solo:dailyProgress:v1";
const DAY_MS = 86_400_000;
const MAX_IVL_DAYS = 30;

export function loadWordStats(): WordStats {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as WordStats) : {};
  } catch {
    return {};
  }
}

export function isDue(stat: WordStat | undefined, now: number): boolean {
  if (!stat || stat.seen === 0) return true;
  return now >= stat.lastSeenAt + (stat.ivl ?? 0) * DAY_MS;
}

function nextIvl(prev: WordStat | undefined, correct: boolean): number {
  if (!correct) return 0;
  const cur = prev?.ivl ?? 0;
  return cur === 0 ? 1 : Math.min(cur * 2, MAX_IVL_DAYS);
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Calendar arithmetic (not `now - 24h`): DST shifts make some days 23 or 25
// hours, so subtracting fixed milliseconds can land on the wrong calendar day.
function prevDayKey(now: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return dayKey(d.getTime());
}

// Effective record for right now: after midnight the stored record is stale,
// so reset the daily counters and carry the streak only if the goal was met
// yesterday. Pure — persistence happens in bumpDaily.
export function currentDailyProgress(now: number = Date.now()): DailyProgress {
  const prev = loadDailyProgress();
  if (prev.date === dayKey(now)) return prev;
  return {
    date: dayKey(now),
    correct: 0,
    met: false,
    streak: prev.met && prev.date === prevDayKey(now) ? prev.streak : 0,
    correctWords: [],
  };
}

export function loadDailyProgress(): DailyProgress {
  try {
    const raw = window.localStorage.getItem(DAILY_KEY);
    if (raw) return JSON.parse(raw) as DailyProgress;
  } catch {}
  return { date: "", correct: 0, met: false, streak: 0 };
}

function bumpDaily(word: string, correct: boolean): DailyProgress {
  let next = { ...currentDailyProgress() };
  const correctWords = next.correctWords ?? [];
  if (correct && !correctWords.includes(word)) {
    next = {
      ...next,
      correct: next.correct + 1,
      correctWords: [...correctWords, word],
    };
  }
  if (!next.met && next.correct >= DAILY_GOAL_CORRECT) {
    next = { ...next, met: true, streak: next.streak + 1 };
  }
  try {
    window.localStorage.setItem(DAILY_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable; keep in-memory stats for this session
  }
  return next;
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
      ivl: 0,
    };
    stats[r.word] = {
      seen: prev.seen + 1,
      correct: prev.correct + (r.correct ? 1 : 0),
      wrong: prev.wrong + (r.correct ? 0 : 1),
      lastSeenAt: now,
      ivl: nextIvl(prev, r.correct),
    };
    bumpDaily(r.word, r.correct);
  }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(stats));
  } catch {
    // storage unavailable; keep in-memory stats for this session
  }
  return stats;
}
