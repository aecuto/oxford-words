import { flatMap, sampleSize, shuffle, uniq } from "lodash";
import wordsJson from "../../translator/words.th.json";
import type { Word } from "./types";
import { WORDS_PER_BATTLE } from "../lib/gameConfig";
import type { BattleWord } from "./types";
import type { WordStat, WordStats } from "./wordProgress";

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
  const picked = uniq(sampleSize(distractors, 2));
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
  count: number
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

// Lower tier = picked sooner.
// 0 needs review (more wrong than correct), 1 unseen (new material),
// 2 answered correctly at least once (reduced to last resort).
function tierOf(stat: WordStat | undefined): number {
  if (!stat || stat.seen === 0) return 1;
  if (stat.wrong > stat.correct) return 0;
  return 2;
}

function isVerbType(type: string): boolean {
  return type.toLowerCase().includes("verb");
}

// Share of new-material slots reserved for verbs. Verbs are the highest-value
// Oxford words to drill, but 100% verbs gets monotonous (~60 battles of verbs
// before any noun), so only half of the new slots are verb-first.
const NEW_VERB_RATIO = 0.5;

export function pickBattleWords(
  pool: Word[],
  count: number = WORDS_PER_BATTLE,
  stats: WordStats = {}
): BattleWord[] {
  const tiers: Word[][] = [[], [], []];
  for (const w of pool) tiers[tierOf(stats[w.word])].push(w);

  const review = shuffle(tiers[0]);
  const learned = shuffle(tiers[2]);

  const verbs = shuffle(tiers[1].filter((w) => isVerbType(w.type)));
  const others = shuffle(tiers[1].filter((w) => !isVerbType(w.type)));
  const need = Math.max(0, count - review.length);
  const verbQuota = Math.min(verbs.length, Math.ceil(need * NEW_VERB_RATIO));
  const newHead = shuffle([
    ...verbs.splice(0, verbQuota),
    ...others.splice(0, need - verbQuota),
  ]);
  const newTail = shuffle([...verbs, ...others]);

  const picked = [...review, ...newHead, ...newTail, ...learned].slice(
    0,
    count
  );
  return shuffle(picked).map((w) => buildBattleWord(w, pool));
}

export async function loadWordPool(): Promise<Word[]> {
  const all = wordsJson as Word[];
  const answerable = all.filter((w) => getCorrectAnswer(w) !== "");
  const ox3000 = answerable.filter((w) => w.ox3000);
  return ox3000.length >= WORDS_PER_BATTLE ? ox3000 : answerable;
}
