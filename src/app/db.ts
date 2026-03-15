// db.ts
import Dexie, { Table } from "dexie";
import wordsJson from "../../translator/words.th.json";

export interface TEntry {
  type: string;
  thai: string[];
}

export interface Word {
  id?: number;
  word: string;
  type: string;
  level: string;
  ox3000: boolean;
  ox5000: boolean;
  ok?: boolean;
  pronounce: string;
  entries: TEntry[];
}

export type RoundRow = {
  id?: number; // auto-increment primary key
  wordId: number;
  correct: boolean | null;
  answers: string[];
  order: number; // ascending — retries use Date.now() so they always tail
};

export type CurrentRound = RoundRow & { word: Word };

export class MySubClassedDexie extends Dexie {
  words!: Table<Word, number>;
  rounds!: Table<RoundRow, number>;

  constructor() {
    super("oxDatabase");
    this.version(8)
      .stores({
        words: "++id, word, ok",
        rounds: "++id, order, wordId",
      })
      .upgrade(async (tx) => {
        // Clear old data and add new data with entries
        await tx.table("rounds").clear();

        await tx.table("words").clear();
        await tx.table("words").bulkAdd(wordsJson);
      });
  }
}

export const db = new MySubClassedDexie();

export async function resetDatabase(): Promise<void> {
  await db.transaction("rw", db.rounds, db.words, async () => {
    await db.rounds.clear();
    await db.words.clear();
    await db.words.bulkAdd(wordsJson as Word[]);
  });
}

db.on("ready", async () => {
  const data = await db.words.get({ word: "a" });
  if (!data) {
    await db.words.bulkAdd(wordsJson).catch(console.log);
  }
});
