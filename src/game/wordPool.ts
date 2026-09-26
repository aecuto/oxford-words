import { sampleSize, shuffle, uniq } from "lodash";
import type { BattleWord, Word } from "./types";
import { ANSWER_OPTIONS, DAY_MS, WORDS_PER_BATTLE, type WordList } from "../lib/gameConfig";
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
// 3. Old slots draw due cards from one weighted bag: Pool B counts double
//    Pool C. Retry words (ivl 0) are always due and skip the 30-min session
//    cooldown — active review means they can come straight back in the next
//    battle, even a minute later. With nothing due, the slot falls back to a
//    purely random old word at the same 2x weighting.
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
function isReviewable(s: WordStat, now: number, cooldownUntil: number): boolean {
  if (!isDue(s, now)) return false;
  return isImmediate(s) || s.lastSeenAt < cooldownUntil;
}

// Pool B (learning) weighs 2x Pool C (mastered): each B word enters the draw
// bag twice. Returns an untouched word from either list, or undefined.
function drawWeighted(
  poolB: Word[],
  poolC: Word[],
  taken: Set<string>,
): Word | undefined {
  const bag: Word[] = [];
  for (const w of poolB) if (!taken.has(w.word)) bag.push(w, w);
  for (const w of poolC) if (!taken.has(w.word)) bag.push(w);
  if (bag.length === 0) return undefined;
  return bag[Math.floor(Math.random() * bag.length)];
}

// The source data repeats a headword once per part of speech (e.g. "about" as
// adverb and as preposition) with identical entries, so an undeduped pool deals
// the same word twice in one battle. Shared rule in wordData.ts (the
// translators dedupe with the same helper upstream).
export function dedupeWords(words: Word[]): Word[] {
  return dedupeByHeadword(words);
}

// Interleaved draw shared by PvP and PvE (rules at the top of this file).
function selectWords(candidates: Word[], count: number, stats: WordStats): Word[] {
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

  const drawOld = (): Word | undefined => {
    const dueB: Word[] = [];
    const dueC: Word[] = [];
    for (const w of learning) {
      const s = stats[w.word];
      if (!s || taken.has(w.word) || !isReviewable(s, now, cooldownUntil)) continue;
      // Every retry word has ivl 0, so all reviewable Pool B cards are
      // immediate — there is no separate due queue to jump anymore.
      dueB.push(w);
    }
    for (const w of mastered) {
      const s = stats[w.word];
      if (s && !taken.has(w.word) && isReviewable(s, now, cooldownUntil)) {
        dueC.push(w);
      }
    }
    // Due B/C at 2:1, then a purely random old word as fallback.
    const picked =
      drawWeighted(dueB, dueC, taken) ??
      drawWeighted(learning, mastered, taken);
    if (picked) taken.add(picked.word);
    return picked;
  };

  const freshQueue = shuffle(fresh);
  const picked: Word[] = [];
  for (let i = 0; i < count; i++) {
    // Slots 1/2/3 of each cycle: one new, two old (0-indexed: i % 3 === 0).
    const w =
      i % 3 === 0
        ? drawNew(freshQueue) ?? drawOld() // Pool A dry → 100% old
        : drawOld() ?? drawNew(freshQueue); // Pools B/C dry → 100% new
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
      ...shuffle(all.filter((w) => recent.has(w.word) && !chosen.has(w.word))).slice(
        0,
        count - picked.length
      )
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
