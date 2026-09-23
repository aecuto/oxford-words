import { flatMap, sampleSize, shuffle, uniq } from "lodash";
import wordsJson from "../../translator/words.th.json";
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

export function getCorrectAnswer(word: Word): string {
  const entryType = typeMap[word.type];
  const entries = word.entries ?? [];

  const filteredEntries = entryType
    ? entries.filter((e) => e.type.startsWith(entryType))
    : entries;

  const thaiTranslations = uniq(flatMap(filteredEntries, (e) => e.thai ?? []));

  if (thaiTranslations.length > 0) {
    return thaiTranslations.slice(0, 3).join(", ");
  }

  return entries.flatMap((e) => e.thai ?? [])[0] || "";
}

export function buildAnswers(current: Word, pool: Word[]): string[] {
  const correct = getCorrectAnswer(current);
  const distractors = pool
    .filter((w) => w.word !== current.word)
    .map(getCorrectAnswer)
    .filter((a) => a && a !== correct);
  const picked = uniq(sampleSize(distractors, 3));
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

export function pickBattleWords(
  pool: Word[],
  count: number = WORDS_PER_BATTLE,
  stats: WordStats = {},
): BattleWord[] {
  const now = Date.now();
  const cooldownUntil = now - RECENT_COOLDOWN_MS;
  const due: Word[] = [];
  const fresh: Word[] = [];
  const scheduled: Word[] = [];
  for (const w of pool) {
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

  const picked = [
    ...headDue,
    ...newHead,
    ...tailDue,
    ...newTail,
    ...scheduledSorted,
  ].slice(0, count);
  return shuffle(picked).map((w) => buildBattleWord(w, pool));
}

export async function loadWordPool(): Promise<Word[]> {
  const all = wordsJson as Word[];
  const answerable = all.filter((w) => getCorrectAnswer(w) !== "");
  const ox3000 = answerable.filter((w) => w.ox3000);
  return ox3000.length >= WORDS_PER_BATTLE ? ox3000 : answerable;
}
