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

export class MySubClassedDexie extends Dexie {
  words!: Table<Word>;

  constructor() {
    super("oxDatabase");
    this.version(4)
      .stores({
        words:
          "++id, word, type, level, ox3000, ox5000, ok, pronounce, entries", // Primary key and indexed props
      })
      .upgrade(async (tx) => {
        // Clear old data and add new data with entries
        await tx.table("words").clear();
        await tx.table("words").bulkAdd(wordsJson);
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
