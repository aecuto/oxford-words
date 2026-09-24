// Smoke test for the shared word-picking pipeline: PvP and PvE must go through
// the same pickBattleWords logic and never deal a duplicate headword.
// Run with: npm run smoke
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  dedupeWords,
  loadWordPool,
  mergeWordLists,
  pickBattleWords,
} from "../src/game/wordPool";
import { saveWordResults, type WordResult, type WordStats } from "../src/game/wordProgress";
import { WORDS_PER_BATTLE } from "../src/lib/gameConfig";
import type { BattleWord, Word } from "../src/game/types";

const DAY_MS = 86_400_000;
const BATTLES = 100;

const raw: Word[] = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "public", "words.th.json"), "utf8"),
);

// loadWordPool fetches "/words.th.json" in the browser; serve the same file
// from disk so the real load path (answerable filter, ox3000, dedupe) runs.
globalThis.fetch = (async () => ({
  ok: true,
  json: async () => raw,
})) as unknown as typeof fetch;

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function assertValidBattle(words: BattleWord[], poolWords: Set<string>) {
  assert.ok(words.length > 0, "empty battle");
  const names = words.map((w) => w.word);
  assert.equal(
    new Set(names).size,
    names.length,
    `duplicate word in one battle: ${names.join(", ")}`,
  );
  for (const w of words) {
    assert.ok(poolWords.has(w.word), `"${w.word}" is not in the loaded pool`);
    assert.ok(w.correctAnswer.length > 0, `"${w.word}" has no correct answer`);
    assert.equal(w.options.length, 4, `"${w.word}" has ${w.options.length} options`);
    assert.equal(new Set(w.options).size, 4, `"${w.word}" has duplicate options`);
    assert.ok(w.options.includes(w.correctAnswer), `"${w.word}" options miss the answer`);
  }
}

function assertNoOverlap(prev: BattleWord[], next: BattleWord[], label: string) {
  const prevWords = new Set(prev.map((w) => w.word));
  const repeat = next.filter((w) => prevWords.has(w.word)).map((w) => w.word);
  assert.deepEqual(repeat, [], `${label}: words repeat in back-to-back battles`);
}

async function main() {
  const pool = await loadWordPool();
  const poolWords = new Set(pool.map((w) => w.word));

  check("source data still contains duplicate headwords (regression fixture)", () => {
    assert.ok(raw.length > poolWords.size, "raw data deduped upstream; fixture is stale");
    assert.equal(dedupeWords(raw).length, new Set(raw.map((w) => w.word)).size);
  });

  check("loadWordPool returns one entry per headword", () => {
    assert.equal(poolWords.size, pool.length);
    assert.ok(pool.length >= WORDS_PER_BATTLE);
  });

  // PvE — useSoloBattle: one player, pickBattleWords(pool, N, stats, prev),
  // where prev is the battle just played (reset) or the saved summary (the
  // remount after the result page).
  check(`PvE: ${BATTLES} back-to-back battles, no duplicates, no repeats`, () => {
    let stats: WordStats = {};
    let prev: BattleWord[] = [];
    for (let i = 0; i < BATTLES; i++) {
      const words = pickBattleWords(
        pool,
        WORDS_PER_BATTLE,
        stats,
        prev.map((w) => w.word)
      );
      assert.equal(words.length, WORDS_PER_BATTLE);
      assertValidBattle(words, poolWords);
      if (prev.length) assertNoOverlap(prev, words, "PvE");
      const results: WordResult[] = words.map((w) => ({
        word: w.word,
        correct: (i * 7 + w.word.length) % 10 < 7,
      }));
      stats = saveWordResults(results);
      prev = words;
    }
  });

  // PvP — useBattleRoom: host and guest each run the same picker with their
  // own stats; the room merges both lists with mergeWordLists. Guest join
  // excludes the host's published words; a rematch excludes the shared battle
  // just played (each player's summary covers the shared room word list).
  check(`PvP: ${BATTLES} merged host+guest battles, no duplicates, no repeats`, () => {
    let hostStats: WordStats = {};
    let guestStats: WordStats = {};
    let prevShown: string[] = [];
    let prev: BattleWord[] = [];
    for (let i = 0; i < BATTLES; i++) {
      const host = pickBattleWords(pool, WORDS_PER_BATTLE, hostStats, prevShown);
      const guest = pickBattleWords(
        pool,
        WORDS_PER_BATTLE,
        guestStats,
        i === 0 ? host.map((w) => w.word) : prevShown
      );
      assertValidBattle(host, poolWords);
      assertValidBattle(guest, poolWords);
      const merged = mergeWordLists(host, guest, WORDS_PER_BATTLE);
      assert.equal(merged.length, WORDS_PER_BATTLE, "merged room set is short");
      assertValidBattle(merged, poolWords);
      if (prev.length) assertNoOverlap(prev, merged, "PvP");
      hostStats = saveWordResults(host.map((w) => ({ word: w.word, correct: i % 2 === 0 })));
      guestStats = saveWordResults(guest.map((w) => ({ word: w.word, correct: i % 3 !== 0 })));
      prevShown = merged.map((w) => w.word);
      prev = merged;
    }
  });

  check("PvP and PvE produce the same BattleWord shape", () => {
    const solo = pickBattleWords(pool, 1, {})[0];
    const merged = mergeWordLists(pickBattleWords(pool, 1, {}), [], 1);
    assert.deepEqual(Object.keys(solo).sort(), Object.keys(merged[0]).sort());
  });

  check("due review words re-enter a battle, capped below new words", () => {
    const now = Date.now();
    const dueStats: WordStats = {};
    for (const w of pool.slice(0, 40)) {
      dueStats[w.word] = { seen: 2, correct: 0, wrong: 2, lastSeenAt: now - 3 * DAY_MS, ivl: 1 };
    }
    const words = pickBattleWords(pool, WORDS_PER_BATTLE, dueStats);
    const reviews = words.filter((w) => dueStats[w.word]).length;
    assert.ok(reviews > 0, "no due review word was picked");
    assert.ok(reviews <= Math.ceil(WORDS_PER_BATTLE * 0.7), "review cap exceeded");
  });

  check("exclusion list keeps previous battle words out", () => {
    const prevWords = pool.slice(0, 50).map((w) => w.word);
    const words = pickBattleWords(pool, WORDS_PER_BATTLE, {}, prevWords);
    const repeat = words.filter((w) => prevWords.includes(w.word));
    assert.deepEqual(repeat.map((w) => w.word), []);
  });

  check("excluded words only return to top up a pool that runs dry", () => {
    const fake = (i: number): Word => ({
      word: `w${i}`,
      type: "noun",
      level: "a1",
      ox3000: true,
      ox5000: false,
      pronounce: "",
      entries: [{ type: "N", thai: [`t${i}`] }],
    });
    const tiny = [0, 1, 2, 3, 4].map(fake);
    const words = pickBattleWords(tiny, 4, {}, ["w0", "w1", "w2"]);
    const names = words.map((w) => w.word);
    assert.equal(names.length, 4);
    assert.ok(names.includes("w3") && names.includes("w4"), "fresh words must win");
    assert.equal(
      names.filter((n) => ["w0", "w1", "w2"].includes(n)).length,
      2,
      "excluded words must only fill the shortfall"
    );
  });

  check("answers grade into pool marks and review intervals", () => {
    const stats = saveWordResults([
      { word: "grade-instant", correct: true, ms: 1_500 },
      { word: "grade-slow", correct: true, ms: 2_500 },
      { word: "grade-blank", correct: true, ms: 5_500 },
      { word: "grade-timeout", correct: false, ms: 10_000, timeout: true },
      { word: "grade-false-friend", correct: false, ms: 1_200 },
    ]);
    assert.equal(stats["grade-instant"].mark, "instant");
    assert.equal(stats["grade-instant"].ivl, 14);
    assert.equal(stats["grade-slow"].mark, "slow");
    assert.equal(stats["grade-slow"].ivl, 2);
    assert.equal(stats["grade-blank"].mark, "blank");
    assert.equal(stats["grade-blank"].ivl, 1);
    assert.equal(stats["grade-timeout"].mark, "blank");
    assert.equal(stats["grade-false-friend"].mark, "falseFriend");
    assert.equal(stats["grade-false-friend"].ivl, 0);
  });

  // 1:2 interleaved draw: with plentiful pools every 3-word cycle deals
  // exactly 1 new + 2 old, so count 30 must split 10/20.
  check("1:2 rule: plentiful pools yield 1 new : 2 old", () => {
    const now = Date.now();
    const stats: WordStats = {};
    pool.slice(0, 300).forEach((w) => {
      stats[w.word] = { seen: 1, correct: 0, wrong: 1, lastSeenAt: now - 3 * DAY_MS, ivl: 2, mark: "slow" };
    });
    pool.slice(300, 600).forEach((w) => {
      stats[w.word] = { seen: 1, correct: 1, wrong: 0, lastSeenAt: now - 3 * DAY_MS, ivl: 14, mark: "instant" };
    });
    const words = pickBattleWords(pool, 30, stats);
    const old = words.filter((w) => stats[w.word]).length;
    assert.equal(words.length, 30);
    assert.equal(old, 20, `expected 20 old slots, got ${old}`);
    assert.equal(words.length - old, 10, "expected 10 new slots");
  });

  // Pool B weighs 2x Pool C among due old words. Statistical: 20 old draws
  // per battle at p(B)=2/3, so 150 battles ≈ 3000 draws, σ ≈ 0.9% — the wide
  // 55–80% band keeps the check deterministic in practice.
  check("Pool B (learning) weighs 2x Pool C (mastered)", () => {
    const now = Date.now();
    const stats: WordStats = {};
    pool.slice(0, 400).forEach((w) => {
      stats[w.word] = { seen: 2, correct: 1, wrong: 1, lastSeenAt: now - 3 * DAY_MS, ivl: 2, mark: "slow" };
    });
    pool.slice(400, 800).forEach((w) => {
      stats[w.word] = { seen: 2, correct: 2, wrong: 0, lastSeenAt: now - 30 * DAY_MS, ivl: 14, mark: "instant" };
    });
    let fromB = 0;
    let fromC = 0;
    for (let i = 0; i < 150; i++) {
      for (const w of pickBattleWords(pool, 30, stats)) {
        const mark = stats[w.word]?.mark;
        if (mark === "slow") fromB++;
        else if (mark === "instant") fromC++;
      }
    }
    const share = fromB / (fromB + fromC);
    assert.ok(
      share > 0.55 && share < 0.8,
      `Pool B share ${(share * 100).toFixed(1)}% outside the 2:1 band (B=${fromB}, C=${fromC})`,
    );
  });

  // False friends (ivl 0) are due immediately and jump the queue — even when
  // every other learning word is still inside the 30-min session cooldown.
  check("false friends return immediately at top priority", () => {
    const now = Date.now();
    const stats: WordStats = {};
    pool.slice(0, 100).forEach((w) => {
      stats[w.word] = { seen: 1, correct: 0, wrong: 1, lastSeenAt: now - 5 * 60_000, ivl: 2, mark: "slow" };
    });
    const ff = pool[0];
    stats[ff.word] = { seen: 1, correct: 0, wrong: 1, lastSeenAt: now - 5 * 60_000, ivl: 0, mark: "falseFriend" };
    const words = pickBattleWords(pool, WORDS_PER_BATTLE, stats);
    assert.ok(
      words.some((w) => w.word === ff.word),
      "false friend was not dealt despite being due immediately",
    );
  });

  // Fallback rule: Pool A dry (everything already studied) → draw 100% old;
  // and with empty stats (Pools B/C dry) → draw 100% new.
  check("empty-pool fallbacks fill the battle either way", () => {
    const now = Date.now();
    const allOld: WordStats = {};
    for (const w of pool) {
      allOld[w.word] = { seen: 1, correct: 1, wrong: 0, lastSeenAt: now - 30 * DAY_MS, ivl: 14, mark: "instant" };
    }
    const old = pickBattleWords(pool, WORDS_PER_BATTLE, allOld);
    assert.equal(old.length, WORDS_PER_BATTLE, "no-new-words battle came up short");
    const fresh = pickBattleWords(pool, WORDS_PER_BATTLE, {});
    assert.equal(fresh.length, WORDS_PER_BATTLE, "no-old-words battle came up short");
  });

  if (failures) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll word-pool smoke checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
