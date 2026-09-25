// AI translator: fills the Thai lexicon with Gemini instead of the etlex CSV.
// Reads tools/scrapper/words.json, translates every word+POS pair once
// (batch of 20 per request), and writes the buildEntries-shaped output
// (one row per headword, { type, thai } per part of speech) to this folder.
// Every finished batch is journaled to ai-cache.json, so a crashed or
// rate-limited run resumes where it stopped (delete an entry there to re-translate).
//
// Usage: GEMINI_API_KEY=... pnpm translate-ai [--limit=N] [--dry-run]
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import sleep from "sleep-promise";
import {
  dedupeByHeadword,
  normalizeRawWord,
  posCode,
  type RawWord,
  type Word,
  type WordEntry,
} from "../../../src/game/wordData";

const WORDS_PATH = path.resolve(__dirname, "../../scrapper/words.json");
const OUTPUT_3000_PATH = path.resolve(__dirname, "words.3000.th.json");
const OUTPUT_5000_PATH = path.resolve(__dirname, "words.5000.th.json");
const CACHE_PATH = path.resolve(__dirname, "ai-cache.json");
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";
const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 8;
// free-tier quota for this model is 15 RPM — pace requests up front instead of
// burning attempts on 429s (override with GEMINI_RPM if the quota changes)
const RPM = Number(process.env.GEMINI_RPM ?? 15);

const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? Infinity);
const DRY_RUN = Number.isFinite(LIMIT) || process.argv.includes("--dry-run");

// tsx does not load .env.local — dotenv does; real env vars still win
dotenv.config({ path: path.resolve(__dirname, "../../../.env.local") });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const key = (w: { word: string; type: string }) => `${w.word.toLowerCase()}|${posCode(w.type)}`;

// work journal: { "word|POS": [thai...] } — flushed after every batch so a
// crashed/aborted run only re-pays for the batch that was in flight
function loadCache(): Map<string, string[]> {
  try {
    return new Map(
      Object.entries(JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8")) as Record<string, string[]>),
    );
  } catch {
    return new Map();
  }
}

function saveCache(thai: Map<string, string[]>) {
  // write-then-rename so a crash mid-write can't corrupt the journal
  const tmp = `${CACHE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(thai)));
  fs.renameSync(tmp, CACHE_PATH);
}

// keep request spacing at >= 60s / RPM so steady-state stays under the quota
let lastRequestAt = 0;
async function throttle() {
  const waitMs = lastRequestAt + 60000 / RPM - Date.now();
  if (waitMs > 0) await sleep(waitMs);
  lastRequestAt = Date.now();
}

async function translateBatch(batch: Word[]) {
  const prompt = `
Translate each English word into Thai for a learner dictionary.
Rules:
- Respect POS: the Thai must express the word AS its type ("present" verb = นำเสนอ, noun = ของขวัญ).
- Use the definition/examples when given to pick the right sense.
- Give 1-3 short, common Thai words. No English, no explanations.
- Return only a JSON array of { word, type, thai } echoing each item's word and type.

Input:
${JSON.stringify(batch.map(({ word, type, definition, examples }) => ({ word, type, definition, examples })))}`;

  // 503 "high demand" / 429 spikes can last minutes — escalate backoff (capped
  // at 1 min) across MAX_ATTEMPTS before giving up; the cache keeps prior batches
  for (let attempt = 1; ; attempt++) {
    try {
      await throttle();
      const res = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: { responseMimeType: "application/json" },
      });
      return JSON.parse(res.text ?? "[]") as { word: string; type: string; thai?: string[] }[];
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (attempt >= MAX_ATTEMPTS || (status !== 429 && (typeof status !== "number" || status < 500)))
        throw err;
      const waitMs = Math.min(5000 * 2 ** (attempt - 1), 60000) + Math.round(Math.random() * 1000);
      console.log(
        `  request failed (status ${status}), retrying in ${Math.round(waitMs / 1000)}s ` +
          `(attempt ${attempt}/${MAX_ATTEMPTS})...`,
      );
      await sleep(waitMs);
    }
  }
}

async function main() {
  const words: Word[] = (JSON.parse(fs.readFileSync(WORDS_PATH, "utf-8")) as RawWord[]).map(
    normalizeRawWord,
  );

  // rows repeat a headword once per POS (and across level flags) — translate
  // each word+type pair once; pairs already in the journal are skipped
  const pairs = [...new Map(words.map((w) => [key(w), w] as const)).values()].slice(0, LIMIT);
  const thai = loadCache();
  const pending = pairs.filter((w) => !thai.has(key(w)));
  if (thai.size) console.log(`  resuming: ${thai.size} pairs restored from ai-cache.json`);
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    for (const r of await translateBatch(batch)) {
      // the model sometimes answers with a single string instead of an array
      const raw = Array.isArray(r.thai) ? r.thai : [r.thai];
      const list = raw.map((t) => String(t).trim()).filter(Boolean).slice(0, 3);
      if (list.length) thai.set(key(r), list);
    }
    saveCache(thai);
    console.log(
      `  ${pairs.length - pending.length + Math.min(i + BATCH_SIZE, pending.length)}/${pairs.length} translated`,
    );
  }

  // one row per headword, entries grouped per POS like index.ts's buildEntries
  const rowsByWord = new Map<string, Word[]>();
  for (const w of words) rowsByWord.set(w.word, [...(rowsByWord.get(w.word) ?? []), w]);
  const result: Word[] = [...rowsByWord].map(([word, rows]) => {
    const entries: WordEntry[] = [];
    for (const row of rows) {
      const type = posCode(row.type);
      const list = thai.get(key(row)) ?? [];
      const entry = entries.find((e) => e.type === type);
      if (entry) entry.thai = [...new Set([...entry.thai, ...list])];
      else entries.push({ type, thai: list });
    }
    // the ox3000 row is the base so the shared dedupe keeps it
    return { ...(rows.find((r) => r.ox3000) ?? rows[0]), word, entries };
  });

  const answerable = result.filter((w) => w.entries.some((e) => e.thai.length > 0));
  const deduped = dedupeByHeadword(answerable);
  // definition/examples are prompt-only context — never persisted
  const strip = ({ definition: _d, examples: _e, ...rest }: Word) => rest;

  if (!DRY_RUN) {
    fs.writeFileSync(OUTPUT_3000_PATH, JSON.stringify(deduped.filter((w) => w.ox3000).map(strip)));
    fs.writeFileSync(OUTPUT_5000_PATH, JSON.stringify(deduped.filter((w) => !w.ox3000).map(strip)));
  }

  const missing = pairs.filter((w) => !thai.has(key(w))).length;
  console.log(
    `Done: ${deduped.length} answerable words ` +
      `(ox3000: ${deduped.filter((w) => w.ox3000).length}, missing: ${missing})`,
  );
  if (DRY_RUN) console.log("Dry run — output files not written");
}

main().catch((err) => {
  console.error(err);
  console.error(
    `\nAborted — finished pairs are kept in tools/translator/ai-cache.json; re-run to resume.`,
  );
  process.exit(1);
});
