import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";

// --- types ---
interface CsvRow {
  id: string;
  "e-search": string;
  "e-entry": string;
  "t-entry": string;
  "e-cat": string;
  "t-related": string;
  "e-syn": string;
  "e-ant": string;
}

interface OxWord {
  word: string;
  type: string;
  level: string;
  ox3000: boolean;
  ox5000: boolean;
  pronounce: string;
}

interface WordEntry {
  "e-cat": string;
  "t-entry": string[];
}

interface ResultWord extends OxWord {
  entries: WordEntry[];
  source: "e-search" | "missing";
}

// --- paths ---
const CSV_PATH = path.resolve(__dirname, "etlex-utf8.csv");
const WORDS_PATH = path.resolve(__dirname, "../scrapper/words.json");
const OUTPUT_PATH = path.resolve(__dirname, "words.th.json");
const MISSING_PATH = path.resolve(__dirname, "missing.txt");

// --- build entries from matched rows ---
function buildEntries(rows: CsvRow[]): WordEntry[] {
  const catMap = new Map<string, Set<string>>();

  for (const row of rows) {
    const eCat = row["e-cat"]?.trim();
    const tEntry = row["t-entry"]?.trim();

    if (!eCat) continue;

    if (!catMap.has(eCat)) {
      catMap.set(eCat, new Set());
    }

    if (tEntry) {
      catMap.get(eCat)!.add(tEntry);
    }
  }

  return Array.from(catMap.entries()).map(([eCat, tEntries]) => ({
    "e-cat": eCat,
    "t-entry": Array.from(tEntries),
  }));
}

// --- search by e-search exact match ---
function searchByESearch(word: string, rows: CsvRow[]): CsvRow[] {
  return rows.filter((r) => r["e-search"]?.trim() === word);
}

// --- build single word entry ---
function buildWordEntry(base: OxWord, rows: CsvRow[]): ResultWord {
  const matched = searchByESearch(base.word, rows);
  const source: ResultWord["source"] =
    matched.length > 0 ? "e-search" : "missing";

  return {
    ...base,
    entries: buildEntries(matched),
    source,
  };
}

// --- main ---
function main() {
  const csvRows: CsvRow[] = parse(fs.readFileSync(CSV_PATH, "utf-8"), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const oxWords: OxWord[] = JSON.parse(fs.readFileSync(WORDS_PATH, "utf-8"));

  const result: ResultWord[] = oxWords.map((base) =>
    buildWordEntry(base, csvRows),
  );

  // save words.th.json
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2), "utf-8");

  // save missing.txt
  const missing = result
    .filter((r) => r.source === "missing")
    .map((r) => r.word);

  fs.writeFileSync(MISSING_PATH, missing.join("\n"), "utf-8");

  // log
  const count = (source: ResultWord["source"]) =>
    result.filter((r) => r.source === source).length;

  console.log(`Done: ${result.length} words`);
  console.log(`  e-search : ${count("e-search")}`);
  console.log(`  missing  : ${count("missing")}`);
  console.log(`Output  → words.th.json`);
  console.log(`Missing → missing.txt`);
}

main();
