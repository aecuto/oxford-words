// Phase 2 of the AI translator: turns ai-cache.json into the flat runtime
// files. Reads tools/scrapper/words.json for the row layout, groups the
// cached translations per POS code, keeps only answerable words, dedupes by
// headword, and resolves each row's POS-specific answer with the shared
// resolveThai (the same rule the etlex translator writes with). No network,
// no API key — safe to re-run any time.
//
// Usage: pnpm translate-ai-map
import fs from "fs";
import path from "path";
import {
  dedupeByHeadword,
  normalizeWord,
  posCode,
  resolveThai,
  type Word,
  type WordRow,
} from "../../../src/game/wordData";
import { CACHE_PATH, WORDS_PATH, key } from "./common";

const OUTPUT_3000_PATH = path.resolve(__dirname, "words.3000.th.json");
const OUTPUT_5000_PATH = path.resolve(__dirname, "words.5000.th.json");

function loadCache(): Map<string, string[]> {
  try {
    return new Map(
      Object.entries(
        JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8")) as Record<
          string,
          string[]
        >,
      ),
    );
  } catch {
    return new Map();
  }
}

function main() {
  const rows: WordRow[] = JSON.parse(fs.readFileSync(WORDS_PATH, "utf-8"));
  const thai = loadCache();

  // one row per headword; cached translations grouped per POS code
  const rowsByWord = new Map<string, WordRow[]>();
  for (const r of rows)
    rowsByWord.set(r.word, [...(rowsByWord.get(r.word) ?? []), r]);
  const result: Word[] = [...rowsByWord].map(([word, wordRows]) => {
    const thaiByType = new Map<string, string[]>();
    for (const row of wordRows) {
      const type = posCode(row.type);
      const list = thai.get(key(row)) ?? [];
      const prev = thaiByType.get(type);
      thaiByType.set(type, prev ? [...new Set([...prev, ...list])] : list);
    }
    // the ox3000 row is the base so the shared dedupe keeps it
    const base = normalizeWord(wordRows.find((r) => r.ox3000) ?? wordRows[0]);
    return { ...base, thai: resolveThai(base.type, thaiByType) };
  });

  const answerable = result.filter((w) => w.thai !== "");
  const deduped = dedupeByHeadword(answerable);

  fs.writeFileSync(
    OUTPUT_3000_PATH,
    JSON.stringify(deduped.filter((w) => w.ox3000)),
  );
  fs.writeFileSync(
    OUTPUT_5000_PATH,
    JSON.stringify(deduped.filter((w) => !w.ox3000)),
  );

  const missing = [...new Set(rows.map(key))].filter(
    (k) => !thai.has(k),
  ).length;
  console.log(
    `Done: ${deduped.length} answerable words ` +
      `(ox3000: ${deduped.filter((w) => w.ox3000).length}, ` +
      `ox5000+: ${deduped.length - deduped.filter((w) => w.ox3000).length}, ` +
      `untranslated pairs: ${missing})`,
  );
}

main();
