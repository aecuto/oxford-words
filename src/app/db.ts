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
  pronounce: string;
  entries: TEntry[];
}

export class MySubClassedDexie extends Dexie {
  words!: Table<Word, number>;

  constructor() {
    super("oxDatabase");
    this.version(8).stores({
      words: "++id, word, ok",
      rounds: "++id, order, wordId",
    });
    this.version(9)
      .stores({
        words: "++id, word",
        rounds: null,
      })
      .upgrade(async (tx) => {
        // Practice rounds are gone — drop leftover rows
        await tx.table("rounds").clear();
      });
  }
}

export const db = new MySubClassedDexie();

db.on("ready", async () => {
  const data = await db.words.get({ word: "a" });
  if (!data) {
    await db.words.bulkAdd(wordsJson).catch(console.log);
  }
});
