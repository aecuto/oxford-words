import {
  ANSWER_INSTANT_MS,
  ANSWER_SLOW_MS,
  DAILY_GOAL_CORRECT,
} from "../lib/gameConfig";

// Last answer's grade; decides pool membership in the picker (Pool B/C) and
// the next review interval. Absent on records saved before timing was
// tracked — those fall back to correct > wrong for mastery.
export type AnswerMark = "instant" | "slow" | "blank" | "falseFriend";

export type WordStat = {
  seen: number;
  correct: number;
  wrong: number;
  lastSeenAt: number;
  ivl: number;
  mark?: AnswerMark;
};

export type WordStats = Record<string, WordStat>;

export type WordResult = {
  word: string;
  correct: boolean;
  // Response time in ms and whether the turn expired unanswered; both feed
  // markFor. Legacy callers may omit them (graded conservatively as blank).
  ms?: number;
  timeout?: boolean;
};

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

// Mastered (Pool C) = the last answer was instant. Legacy records without a
// mark keep the old rule (more correct than wrong) so existing data still
// reads sensibly until each word is answered again. Shared by the lobby
// progress panel and the /words page so both agree with the picker's pools.
export function isMastered(stat: WordStat | undefined): boolean {
  if (!stat) return false;
  return stat.mark ? stat.mark === "instant" : stat.correct > stat.wrong;
}

// Pool transition + interval table (days) per answer grade. ivl 0 keeps a
// false friend due immediately, so the very next battle deals it first.
const MARK_IVL_DAYS: Record<AnswerMark, number> = {
  instant: 14,
  slow: 2,
  blank: 1,
  falseFriend: 0,
};

// Grade an answer from its response time. A wrong pick is a false friend no
// matter how fast; a timeout is a blank (the answer never came). Correct
// answers without timing (legacy callers) grade conservatively as blank.
function markFor(
  correct: boolean,
  ms: number | undefined,
  timeout: boolean | undefined,
): AnswerMark {
  if (timeout) return "blank";
  if (!correct) return "falseFriend";
  if (ms != null && ms < ANSWER_INSTANT_MS) return "instant";
  if (ms != null && ms < ANSWER_SLOW_MS) return "slow";
  return "blank";
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
    const mark = markFor(r.correct, r.ms, r.timeout);
    stats[r.word] = {
      seen: prev.seen + 1,
      correct: prev.correct + (r.correct ? 1 : 0),
      wrong: prev.wrong + (r.correct ? 0 : 1),
      lastSeenAt: now,
      ivl: MARK_IVL_DAYS[mark],
      mark,
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
