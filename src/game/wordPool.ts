import { flatMap, sampleSize, shuffle, uniq } from "lodash";
import { db, type Word } from "../app/db";
import wordsJson from "../../translator/words.th.json";
import { WORDS_PER_BATTLE } from "../lib/gameConfig";
import type { BattleWord } from "./types";

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
    .filter((w) => w.id !== current.id)
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

export function pickBattleWords(
  pool: Word[],
  count: number = WORDS_PER_BATTLE
): BattleWord[] {
  return sampleSize(pool, Math.min(count, pool.length)).map((w) =>
    buildBattleWord(w, pool)
  );
}

export async function loadWordPool(): Promise<Word[]> {
  const count = await db.words.count();
  if (count === 0) {
    await db.words.bulkAdd(wordsJson as Word[]);
  }
  const all = await db.words.toArray();
  const answerable = all.filter((w) => getCorrectAnswer(w) !== "");
  const ox3000 = answerable.filter((w) => w.ox3000);
  return ox3000.length >= WORDS_PER_BATTLE ? ox3000 : answerable;
}
