import { flatMap, sampleSize, shuffle, uniq } from "lodash";
import type { Word } from "./types";
import { WORDS_PER_BATTLE } from "../lib/gameConfig";
import type { BattleWord } from "./types";
import { isDue, type WordStat, type WordStats } from "./wordProgress";

const typeMap: Record<string, string> = {
  noun: "N",
  verb: "V",
  adjective: "ADJ",
  adverb: "ADV",
};

// The pool is a stable module-level object, so memoizing per word object turns
// the repeated O(pool) scans in buildAnswers/loadWordPool into cache hits.
const answerCache = new WeakMap<Word, string>();

export function getCorrectAnswer(word: Word): string {
  const cached = answerCache.get(word);
  if (cached !== undefined) return cached;
  const entryType = typeMap[word.type];
  const entries = word.entries ?? [];

  const filteredEntries = entryType
    ? entries.filter((e) => e.type.startsWith(entryType))
    : entries;

  const thaiTranslations = uniq(flatMap(filteredEntries, (e) => e.thai ?? []));

  const answer =
    thaiTranslations.length > 0
      ? thaiTranslations.slice(0, 3).join(", ")
      : entries.flatMap((e) => e.thai ?? [])[0] || "";
  answerCache.set(word, answer);
  return answer;
}

export function buildAnswers(current: Word, pool: Word[]): string[] {
  const correct = getCorrectAnswer(current);
  const distractors: string[] = [];
  for (const w of pool) {
    if (w.word === current.word) continue;
    const a = getCorrectAnswer(w);
    if (a && a !== correct) distractors.push(a);
  }
  // uniq before sampling: distractors can repeat the same answer string, and
  // sampling duplicates would shrink the grid below 4 options.
  const picked = sampleSize(uniq(distractors), 3);
  return shuffle([correct, ...picked]);
}

export function buildBattleWord(word: Word, pool: Word[]): BattleWord {
  return {
    word: word.word,
    type: word.type,
    level: word.level,
    pronounce: word.pronounce,
    correctAnswer: getCorrectAnswer(word),
    options: buildAnswers(word, pool),
  };
}

// Interleave two players' priority lists (host word, guest word, ...) so the
// shared room set reflects both players' review/new words, deduped by word.
export function mergeWordLists(
  a: BattleWord[],
  b: BattleWord[],
  count: number,
): BattleWord[] {
  const merged: BattleWord[] = [];
  const seen = new Set<string>();
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen && merged.length < count; i++) {
    for (const list of [a, b]) {
      const w = list[i];
      if (w && !seen.has(w.word)) {
        seen.add(w.word);
        merged.push(w);
        if (merged.length >= count) break;
      }
    }
  }
  return merged;
}

// Pick rules, ordered for fastest learning:
// 1. Review: due words first, hardest/most-overdue first — leeches (2+ wrong),
//    then high error rate, then words overdue relative to their interval.
//    Sampled randomly from the top-priority candidates so consecutive battles
//    don't drill the exact same words.
// 2. Review cap: reviews fill at most REVIEW_MAX_RATIO of the battle so new
//    words keep flowing even during heavy review days.
// 3. New words follow Oxford level order (A1 → A2 → B1 → B2 → C1), so the
//    foundation is built before harder vocabulary; random within a level.
// 4. Verb variety: half of the new-word slots prefer verbs so drilling stays
//    varied without becoming monotonous.
// 5. Fallbacks: overdue-but-capped reviews, then scheduled words ordered by
//    soonest next due date (near-due beats random).
// 6. Session cooldown: words seen within RECENT_COOLDOWN_MS are held out of
//    reviews so back-to-back battles never repeat the same word.
const DAY_MS = 86_400_000;
const REVIEW_MAX_RATIO = 0.7;
const NEW_VERB_RATIO = 0.5;
const LEECH_WRONGS = 2;
const LEECH_BONUS = 10;
const ERR_RATE_WEIGHT = 3;
const RECENT_COOLDOWN_MS = 30 * 60_000;
const DUE_SAMPLE_FACTOR = 3;

const LEVEL_ORDER = ["a1", "a2", "b1", "b2", "c1", "c2"] as const;

function isVerbType(type: string): boolean {
  return type.toLowerCase().includes("verb");
}

function levelRank(level: string): number {
  const i = LEVEL_ORDER.indexOf(level.toLowerCase() as (typeof LEVEL_ORDER)[number]);
  return i === -1 ? LEVEL_ORDER.length : i;
}

// The source data repeats a headword once per part of speech (e.g. "about" as
// adverb and as preposition) with identical entries, so an undeduped pool deals
// the same word twice in one battle. Keep one entry per word, preferring the
// ox3000-flagged copy.
export function dedupeWords(words: Word[]): Word[] {
  const byWord = new Map<string, Word>();
  for (const w of words) {
    const prev = byWord.get(w.word);
    if (!prev || (!prev.ox3000 && w.ox3000)) byWord.set(w.word, w);
  }
  return [...byWord.values()];
}

function duePriority(s: WordStat | undefined, now: number): number {
  if (!s) return 0;
  const ivlDays = Math.max(s.ivl, 1);
  const overdueRatio = (now - s.lastSeenAt) / (ivlDays * DAY_MS) - 1;
  const errRate = s.seen > 0 ? s.wrong / s.seen : 0;
  let score = overdueRatio + errRate * ERR_RATE_WEIGHT;
  if (s.wrong >= LEECH_WRONGS) score += LEECH_BONUS;
  return score;
}

function nextDueAt(s: WordStat | undefined): number {
  if (!s) return Infinity;
  return s.lastSeenAt + Math.max(s.ivl, 1) * DAY_MS;
}

// Priority pipeline shared by PvP and PvE (rules at the top of this file).
function selectWords(candidates: Word[], count: number, stats: WordStats): Word[] {
  const now = Date.now();
  const cooldownUntil = now - RECENT_COOLDOWN_MS;
  const due: Word[] = [];
  const fresh: Word[] = [];
  const scheduled: Word[] = [];
  for (const w of candidates) {
    const s = stats[w.word];
    if (!s || s.seen === 0) fresh.push(w);
    else if (isDue(s, now) && s.lastSeenAt < cooldownUntil) due.push(w);
    else scheduled.push(w);
  }

  const dueSorted = due.sort(
    (a, b) => duePriority(stats[b.word], now) - duePriority(stats[a.word], now),
  );
  const reviewCap = Math.min(dueSorted.length, Math.ceil(count * REVIEW_MAX_RATIO));
  const headDue = sampleSize(
    dueSorted.slice(0, reviewCap * DUE_SAMPLE_FACTOR),
    reviewCap,
  );
  const headSet = new Set(headDue.map((w) => w.word));
  const tailDue = dueSorted.filter((w) => !headSet.has(w.word));

  const ranks = [...new Set(fresh.map((w) => levelRank(w.level)))].sort((a, b) => a - b);
  const freshOrdered = ranks.flatMap((rank) =>
    shuffle(fresh.filter((w) => levelRank(w.level) === rank)),
  );

  const need = Math.max(0, count - headDue.length);
  const verbs = freshOrdered.filter((w) => isVerbType(w.type));
  const others = freshOrdered.filter((w) => !isVerbType(w.type));
  const verbQuota = Math.min(verbs.length, Math.ceil(need * NEW_VERB_RATIO));
  const newHead = shuffle([
    ...verbs.splice(0, verbQuota),
    ...others.splice(0, need - verbQuota),
  ]);
  const newTail = shuffle([...verbs, ...others]);

  const scheduledSorted = scheduled.sort(
    (a, b) => nextDueAt(stats[a.word]) - nextDueAt(stats[b.word]),
  );

  return [
    ...headDue,
    ...newHead,
    ...tailDue,
    ...newTail,
    ...scheduledSorted,
  ].slice(0, count);
}

function toBattleWords(picked: Word[]): BattleWord[] {
  // One pass over the pool for all answer keys instead of one scan per word.
  const answers = new Map(picked.map((w) => [w.word, getCorrectAnswer(w)]));
  return shuffle(picked).map((w) => {
    const correct = answers.get(w.word) ?? "";
    const distractors: string[] = [];
    for (const [other, a] of answers) {
      if (other === w.word || !a || a === correct) continue;
      distractors.push(a);
    }
    const options = shuffle([correct, ...sampleSize(uniq(distractors), 3)]);
    return {
      word: w.word,
      type: w.type,
      level: w.level,
      pronounce: w.pronounce,
      correctAnswer: correct,
      options,
    };
  });
}

export function pickBattleWords(
  pool: Word[],
  count: number = WORDS_PER_BATTLE,
  stats: WordStats = {},
  exclude: Iterable<string> = [],
): BattleWord[] {
  const all = dedupeWords(pool);
  const recent = new Set(exclude);
  // Words already dealt in this room's previous battle — by either player —
  // are held out so back-to-back battles and PvP rematches deal a fresh set;
  // they only return if the pool is too small to fill the battle otherwise.
  const candidates = recent.size ? all.filter((w) => !recent.has(w.word)) : all;
  const picked = selectWords(candidates, count, stats);
  if (picked.length < count) {
    const chosen = new Set(picked.map((w) => w.word));
    picked.push(
      ...shuffle(all.filter((w) => recent.has(w.word) && !chosen.has(w.word))).slice(
        0,
        count - picked.length
      )
    );
  }
  return toBattleWords(picked);
}

// The 3MB word data lives in public/ and is fetched once per session instead
// of being imported into the JS bundle, so the battle page ships kilobytes of
// code instead of megabytes of JSON to download and parse on the main thread.
let poolPromise: Promise<Word[]> | null = null;

export function loadWordPool(): Promise<Word[]> {
  poolPromise ??= fetch("/words.th.json")
    .then((res) => {
      if (!res.ok) throw new Error(`words.th.json: HTTP ${res.status}`);
      return res.json() as Promise<Word[]>;
    })
    .then((all) => {
      const answerable = dedupeWords(all.filter((w) => getCorrectAnswer(w) !== ""));
      const ox3000 = answerable.filter((w) => w.ox3000);
      return ox3000.length >= WORDS_PER_BATTLE ? ox3000 : answerable;
    });
  return poolPromise;
}
