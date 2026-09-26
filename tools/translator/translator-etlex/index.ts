import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import {
  dedupeByHeadword,
  normalizeWord,
  resolveThai,
  type Word,
  type WordRow,
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

// --- thai translations per lexicon category (e-cat) from matched rows ---
function buildThaiMap(rows: CsvRow[]): Map<string, string[]> {
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

  return new Map([...catMap].map(([eCat, tEntries]) => [eCat, [...tEntries]]));
}

// --- search by e-search exact match ---
function searchByESearch(word: string, rows: CsvRow[]): CsvRow[] {
  return rows.filter((r) => r["e-search"]?.trim() === word);
}

// --- build single word: the row's thai resolved straight from its CSV matches ---
function buildWord(base: Word, rows: CsvRow[]): ResultWord {
  const matched = searchByESearch(base.word, rows);
  return {
    ...base,
    thai: resolveThai(base.type, buildThaiMap(matched)),
    source: matched.length > 0 ? "e-search" : "missing",
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

  // rows come in via the shared normalizeWord (scrapper row → Word); each
  // row's thai is resolved straight from its CSV matches below
  const oxWords: Word[] = (
    JSON.parse(fs.readFileSync(WORDS_PATH, "utf-8")) as WordRow[]
  ).map(normalizeWord);

  const result: ResultWord[] = oxWords.map((base) => buildWord(base, csvRows));

  // save level files
  // Same order as loadWordPool's runtime chain: answerable filter first (at
  // least one Thai translation, mirroring getCorrectAnswer !== ""), then
  // dedupe. A word whose only ox3000 row has no translation falls back to its
  // ox5000 rows exactly like the runtime pool does. Files are disjoint:
  // words.3000.th.json holds the ox3000 words, words.5000.th.json only the
  // extra ox5000 words — loadWordPool("5000") fetches and merges both.
  // `source` is build metadata — the runtime Word shape is word…pronounceURL
  // + thai, already flat. Minified, like before — Vercel compresses on the wire.
  const answerable = result.filter((w) => w.thai !== "");
  const deduped = dedupeByHeadword(answerable);
  const stripSource = ({ source: _source, ...rest }: ResultWord): Word => rest;
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
