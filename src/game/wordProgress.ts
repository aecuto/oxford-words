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

export function loadDailyProgress(): DailyProgress {
  try {
    const raw = window.localStorage.getItem(DAILY_KEY);
    if (raw) return JSON.parse(raw) as DailyProgress;
  } catch {}
  return { date: "", correct: 0, met: false, streak: 0 };
}

function bumpDaily(correct: boolean): DailyProgress {
  const prev = loadDailyProgress();
  const today = dayKey(Date.now());
  let next: DailyProgress;
  if (prev.date === today) {
    next = { ...prev, correct: prev.correct + (correct ? 1 : 0) };
  } else {
    const yesterday = dayKey(Date.now() - DAY_MS);
    next = {
      date: today,
      correct: correct ? 1 : 0,
      met: false,
      streak: prev.met && prev.date === yesterday ? prev.streak : 0,
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
    bumpDaily(r.correct);
  }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(stats));
  } catch {
    // storage unavailable; keep in-memory stats for this session
  }
  return stats;
}
