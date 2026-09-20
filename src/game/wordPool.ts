import { flatMap, sampleSize, shuffle, uniq } from "lodash";
import wordsJson from "../../translator/words.th.json";
import type { Word } from "./types";
import { WORDS_PER_BATTLE } from "../lib/gameConfig";
import type { BattleWord } from "./types";
import { isDue, type WordStats } from "./wordProgress";

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

// Pick order: due words first (wrong answers are due immediately, correct
// answers resurface after twice the previous interval), then new words, then
// words not due yet. Within new words, half the slots are verb-first so
// drilling stays varied without becoming monotonous.
function isVerbType(type: string): boolean {
  return type.toLowerCase().includes("verb");
}

const NEW_VERB_RATIO = 0.5;

export function pickBattleWords(
  pool: Word[],
  count: number = WORDS_PER_BATTLE,
  stats: WordStats = {}
): BattleWord[] {
  const now = Date.now();
  const due: Word[] = [];
  const fresh: Word[] = [];
  const scheduled: Word[] = [];
  for (const w of pool) {
    const s = stats[w.word];
    if (!s || s.seen === 0) fresh.push(w);
    else if (isDue(s, now)) due.push(w);
    else scheduled.push(w);
  }
  shuffle(due);
  shuffle(fresh);
  shuffle(scheduled);

  const need = Math.max(0, count - due.length);
  const verbs = fresh.filter((w) => isVerbType(w.type));
  const others = fresh.filter((w) => !isVerbType(w.type));
  const verbQuota = Math.min(verbs.length, Math.ceil(need * NEW_VERB_RATIO));
  const newHead = shuffle([
    ...verbs.splice(0, verbQuota),
    ...others.splice(0, need - verbQuota),
  ]);
  const newTail = shuffle([...verbs, ...others]);

  const picked = [...due, ...newHead, ...newTail, ...scheduled].slice(
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
