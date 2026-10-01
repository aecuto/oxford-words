import { sampleSize, shuffle, sortBy, uniq } from "lodash";
import type { BattleWord, Word } from "./types";
import {
  ANSWER_OPTIONS,
  DAY_MS,
  WORDS_PER_BATTLE,
  type WordList,
} from "../lib/gameConfig";
import { loadWordList } from "./wordList";
import {
  isDue,
  isMastered,
  type WordStat,
  type WordStats,
} from "./wordProgress";
import { dedupeByHeadword } from "./wordData";

// The answer is resolved at build time (resolveThai in wordData.ts) and ships
// flat on the word, so grading is a plain field read.
export function getCorrectAnswer(word: Word): string {
  return word.thai;
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

// Pick rules — three pools and a 1:2 interleaved draw:
// 1. Pool A (new): never studied. Pool B (learning): last answer graded
//    "retry" — hesitated past 2s, guessed, wrong, or timed out. Pool C
//    (mastered): last answer was instant (<2s). Words stay in their pool
//    until re-answered; because retry intervals are 0 days, a learning word
//    is always due long before the 14-day learning window could expire, so
//    the window never gates a review out.
// 2. Battles deal a repeating 1 new : 2 old cycle, so reviews always outweigh
//    fresh words 2:1 — that ratio replaces the old 70% review cap. Empty-pool
//    fallbacks: Pool A dry → draw everything from B/C; B/C dry → all new.
// 3. Old slots draw due cards from one weighted pair: Pool B counts double
//    Pool C via a fixed B,B,C slot cycle (deterministic, like the 1:2 cycle).
//    Within each pool the LEAST-RECENTLY-SEEN word is drawn first, so a word
//    only returns after the rest of its due queue has cycled — a uniform
//    random draw instead clumps: with a small learning pool the same words
//    re-deal every battle or two while most of the queue starves. Retry
//    words (ivl 0) are always due and skip the 30-min session cooldown —
//    active review means they stay eligible, just oldest-first. With nothing
//    due, the slot falls back to the least-recently-seen old word at the
//    same 2x weighting.
// 4. The 30-min session cooldown holds only mastered (14-day) reviews out of
//    draws. The caller's exclude list (the previous battle's set) still wins
//    over everything, so a retry word returns one battle later instead of
//    repeating inside a fresh deal.
// 5. toBattleWords shuffles the dealt set, so the 1:2 cycle never becomes a
//    memorizable position pattern.
const RECENT_COOLDOWN_MS = 30 * 60_000;

// A word due right now regardless of cooldown: retry words (ivl 0) are
// scheduled for immediate re-review — the "active review" half of the
// 2-option rule.
function isImmediate(s: WordStat): boolean {
  return s.ivl === 0;
}

// Old-slot candidate check: due first, with the session cooldown applied to
// everything except immediate (retry) cards.
function isReviewable(
  s: WordStat,
  now: number,
  cooldownUntil: number,
): boolean {
  if (!isDue(s, now)) return false;
  return isImmediate(s) || s.lastSeenAt < cooldownUntil;
}

// Pool B (learning) weighs 2x Pool C (mastered): a fixed B,B,C slot cycle —
// deterministic like the 1:2 new:old cycle, so the share holds exactly at
// 2:1 when both pools are plentiful. Each pool is an oldest-first queue;
// when the wanted pool runs dry the other takes the slot.
function drawOldPair(
  poolB: Word[],
  poolC: Word[],
  taken: Set<string>,
  oldSlot: number,
): Word | undefined {
  const first = oldSlot % 3 === 2 ? poolC : poolB;
  const second = oldSlot % 3 === 2 ? poolB : poolC;
  return drawOldest(first, taken) ?? drawOldest(second, taken);
}

// First not-yet-taken word of an oldest-first queue, or undefined.
function drawOldest(queue: Word[], taken: Set<string>): Word | undefined {
  const w = queue.find((x) => !taken.has(x.word));
  if (w) taken.add(w.word);
  return w;
}

// Shuffle first so equal lastSeenAt (one battle's cohort shares a timestamp)
// tie-break randomly, then stable-sort oldest-first.
function byOldest(pool: Word[], stats: WordStats): Word[] {
  return sortBy(shuffle(pool), (w) => stats[w.word]?.lastSeenAt ?? 0);
}

// The source data repeats a headword once per part of speech (e.g. "about" as
// adverb and as preposition) with identical entries, so an undeduped pool deals
// the same word twice in one battle. Shared rule in wordData.ts (the
// translators dedupe with the same helper upstream).
export function dedupeWords(words: Word[]): Word[] {
  return dedupeByHeadword(words);
}

// Interleaved draw shared by PvP and PvE (rules at the top of this file).
function selectWords(
  candidates: Word[],
  count: number,
  stats: WordStats,
): Word[] {
  const now = Date.now();
  const cooldownUntil = now - RECENT_COOLDOWN_MS;

  const fresh: Word[] = []; // Pool A: never studied
  const learning: Word[] = []; // Pool B: retry (hesitated/guessed/wrong/timeout)
  const mastered: Word[] = []; // Pool C: instant (<2s)
  for (const w of candidates) {
    const s = stats[w.word];
    if (!s || s.seen === 0) fresh.push(w);
    else if (isMastered(s)) mastered.push(w);
    else learning.push(w);
  }

  const taken = new Set<string>();

  const drawNew = (queue: Word[]): Word | undefined => {
    const w = queue.pop();
    if (w) taken.add(w.word);
    return w;
  };

  const learningQ = byOldest(learning, stats);
  const masteredQ = byOldest(mastered, stats);
  let oldSlot = 0;

  const drawOld = (): Word | undefined => {
    // Due subsets keep their queues' oldest-first order.
    const dueB = learningQ.filter(
      (w) =>
        !taken.has(w.word) && isReviewable(stats[w.word], now, cooldownUntil),
    );
    const dueC = masteredQ.filter(
      (w) =>
        !taken.has(w.word) && isReviewable(stats[w.word], now, cooldownUntil),
    );
    // Due B/C at 2:1, least-recently-seen first; with nothing due, the same
    // cycle falls back to the least-recently-seen old word of either pool.
    return (
      drawOldPair(dueB, dueC, taken, oldSlot++) ??
      drawOldPair(learningQ, masteredQ, taken, oldSlot++)
    );
  };

  const freshQueue = shuffle(fresh);
  const picked: Word[] = [];
  for (let i = 0; i < count; i++) {
    // Slots 1/2/3 of each cycle: one new, two old (0-indexed: i % 3 === 0).
    const w =
      i % 3 === 0
        ? (drawNew(freshQueue) ?? drawOld()) // Pool A dry → 100% old
        : (drawOld() ?? drawNew(freshQueue)); // Pools B/C dry → 100% new
    if (!w) break;
    picked.push(w);
  }
  return picked;
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
    const options = shuffle([
      correct,
      ...sampleSize(uniq(distractors), ANSWER_OPTIONS - 1),
    ]);
    return {
      word: w.word,
      type: w.type,
      level: w.level,
      pronounceURL: w.pronounceURL,
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
      ...shuffle(
        all.filter((w) => recent.has(w.word) && !chosen.has(w.word)),
      ).slice(0, count - picked.length),
    );
  }
  return toBattleWords(picked);
}

// The word data lives in public/ as two disjoint per-list files: the
// translator emits pre-deduped, answerable-only words with words.3000.th.json
// holding the ox3000 list and words.5000.th.json only the extra ox5000 words.
// The lists are exclusive — 3000 plays only the core words, 5000 only the
// advanced ones — so a list load is a single fetch, no merging. Data is
// fetched once per session instead of being imported into the JS bundle, so
// the battle page ships kilobytes of code instead of megabytes of JSON to
// download and parse on the main thread. The default list is the player's
// persisted pick (localStorage via wordList.ts), evaluated per call — so a
// list switch applies from the next battle on.
let poolPromises: Partial<Record<WordList, Promise<Word[]>>> = {};

async function fetchList(list: WordList): Promise<Word[]> {
  const res = await fetch(`/words.${list}.th.json`);
  if (!res.ok) throw new Error(`words.${list}.th.json: HTTP ${res.status}`);
  return res.json() as Promise<Word[]>;
}

export function loadWordPool(list: WordList = loadWordList()): Promise<Word[]> {
  poolPromises[list] ??= fetchList(list).then((all) => {
    // The translator already dedupes and drops unanswerable entries; keep
    // both runtime filters anyway — dedupeWords must stay applied so
    // pickBattleWords can never deal the same headword twice.
    return dedupeWords(all.filter((w) => getCorrectAnswer(w) !== ""));
  });
  return poolPromises[list];
}
