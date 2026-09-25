import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import {
  dedupeByHeadword,
  normalizeRawWord,
  type RawWord,
  type Word,
  type WordEntry,
} from "../../../src/game/wordData";

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

type ResultWord = Word & {
  source: "e-search" | "missing";
};

// --- paths ---
const CSV_PATH = path.resolve(__dirname, "etlex-utf8.csv");
const WORDS_PATH = path.resolve(__dirname, "../../scrapper/words.json");
const OUTPUT_3000_PATH = path.resolve(__dirname, "words.3000.th.json");
const OUTPUT_5000_PATH = path.resolve(__dirname, "words.5000.th.json");
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
    type: eCat,
    thai: Array.from(tEntries),
  }));
}

// --- search by e-search exact match ---
function searchByESearch(word: string, rows: CsvRow[]): CsvRow[] {
  return rows.filter((r) => r["e-search"]?.trim() === word);
}

// --- build single word entry ---
function buildWordEntry(base: Word, rows: CsvRow[]): ResultWord {
  const matched = searchByESearch(base.word, rows);
  const source: ResultWord["source"] =
    matched.length > 0 ? "e-search" : "missing";

  return {
    ...base,
    entries: buildEntries(matched),
    source,
  };
}

// --- dedupe via the shared headword rule ---
// The scrapper emits one row per part of speech, so the level files are
// pre-deduped upstream and the runtime dedupe stays a no-op safety net.
// Shared impl: dedupeByHeadword in src/game/wordData.ts.

// --- main ---
function main() {
  const csvRows: CsvRow[] = parse(fs.readFileSync(CSV_PATH, "utf-8"), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  // rows come in via the shared normalizeRawWord (pronounce fallback, list
  // normalization); this translator ignores definition/examples and strips
  // them before writing
  const oxWords: Word[] = (
    JSON.parse(fs.readFileSync(WORDS_PATH, "utf-8")) as RawWord[]
  ).map(normalizeRawWord);

  const result: ResultWord[] = oxWords.map((base) =>
    buildWordEntry(base, csvRows),
  );

  // save level files
  // Same order as loadWordPool's runtime chain: answerable filter first (at
  // least one Thai translation, mirroring getCorrectAnswer !== ""), then
  // dedupe. A word whose only ox3000 row has no translation falls back to its
  // ox5000 rows exactly like the runtime pool does. Files are disjoint:
  // words.3000.th.json holds the ox3000 words, words.5000.th.json only the
  // extra ox5000 words — loadWordPool("5000") fetches and merges both.
  // `source` is stripped: answerable entries are all "e-search" build
  // metadata. Minified, like before — Vercel compresses on the wire.
  const answerable = result.filter((w) =>
    w.entries.some((e) => e.thai.length > 0),
  );
  const deduped = dedupeByHeadword(answerable);
  // `source` and the prompt-only definition/examples are build metadata —
  // the runtime Word shape is word…pronounceURL + entries
  const stripSource = ({
    source: _source,
    definition: _definition,
    examples: _examples,
    ...rest
  }: ResultWord) => rest;
  fs.writeFileSync(
    OUTPUT_3000_PATH,
    JSON.stringify(deduped.filter((w) => w.ox3000).map(stripSource)),
    "utf-8",
  );
  fs.writeFileSync(
    OUTPUT_5000_PATH,
    JSON.stringify(deduped.filter((w) => !w.ox3000).map(stripSource)),
    "utf-8",
  );

  // save missing.txt
  const missing = result
    .filter((r) => r.source === "missing")
    .map((r) => r.word);

  fs.writeFileSync(MISSING_PATH, missing.join("\n"), "utf-8");

  // log
  const count = (source: ResultWord["source"]) =>
    result.filter((r) => r.source === source).length;

  const ox3000Count = deduped.filter((w) => w.ox3000).length;
  console.log(`Done: ${result.length} rows → ${deduped.length} unique words`);
  console.log(`  e-search : ${count("e-search")}`);
  console.log(`  missing  : ${count("missing")}`);
  console.log(`  ox3000   : ${ox3000Count} (words.3000.th.json)`);
  console.log(
    `  ox5000+  : ${deduped.length - ox3000Count} (words.5000.th.json)`,
  );
  console.log(`Output  → words.3000.th.json + words.5000.th.json`);
  console.log(`Missing → missing.txt`);
}

main();
