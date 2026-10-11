// Smoke test for the shared word-picking pipeline: PvP and PvE must go through
// the same pickBattleWords logic and never deal a duplicate headword.
// Run with: npm run smoke
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  dedupeWords,
  getCorrectAnswer,
  loadWordPool,
  mergeWordLists,
  pickBattleWords,
  roomWordSet,
} from "../src/game/wordPool";
import { saveWordResults, type WordResult, type WordStats } from "../src/game/wordProgress";
import {
  answerStreak,
  applyPlacement,
  botPickCell,
  checkWinner,
  completesStreak,
  createBoard,
  markFor,
  nextToFade,
  placementWords,
} from "../src/game/tictactoe";
import {
  ANSWER_OPTIONS,
  DAY_MS,
  MARKS_PER_PLAYER,
  PLACEMENT_STREAK,
  WORDS_PER_BATTLE,
} from "../src/lib/gameConfig";
import type { BattleWord, Move, SlotKey, Word } from "../src/game/types";

const BATTLES = 100;

const readList = (name: string): Word[] =>
  JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "public", name), "utf8"),
  );

const raw3000: Word[] = readList("words.3000.th.json");
const raw5000: Word[] = readList("words.5000.th.json");

// loadWordPool fetches "/words.<list>.th.json" in the browser; serve the
// same files from disk so the real load path (answerable filter, dedupe,
// 3000→5000 fallback) runs.
globalThis.fetch = (async (input: RequestInfo | URL) => ({
  ok: true,
  json: async () => (String(input).includes("5000") ? raw5000 : raw3000),
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
    assert.equal(w.options.length, ANSWER_OPTIONS, `"${w.word}" has ${w.options.length} options`);
    assert.equal(new Set(w.options).size, ANSWER_OPTIONS, `"${w.word}" has duplicate options`);
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
  const pool5000 = await loadWordPool("5000");
  const poolWords = new Set(pool.map((w) => w.word));

  check("list files are pre-deduped, answerable, disjoint (fixture)", () => {
    const words3000 = new Set(raw3000.map((w) => w.word));
    const words5000 = new Set(raw5000.map((w) => w.word));
    assert.ok(raw5000.length > 0, "5000 file is empty");
    for (const w of words3000) {
      assert.ok(!words5000.has(w), `"${w}" appears in both list files`);
    }
    for (const [name, raw] of [
      ["3000", raw3000],
      ["5000", raw5000],
    ] as const) {
      assert.equal(
        dedupeWords(raw).length,
        raw.length,
        `${name} file has duplicate headwords; translator dedupe broke`,
      );
      assert.equal(
        new Set(raw.map((w) => w.word)).size,
        raw.length,
        `${name} file repeats a headword`,
      );
      assert.ok(
        raw.every((w) => getCorrectAnswer(w) !== ""),
        `${name} file contains unanswerable words`,
      );
    }
    assert.ok(
      raw3000.every((w) => w.ox3000),
      "3000 file contains non-ox3000 words",
    );
    assert.ok(
      raw5000.every((w) => !w.ox3000),
      "5000 file contains ox3000 words",
    );
  });

  check("loadWordPool returns one entry per headword", () => {
    assert.equal(poolWords.size, pool.length);
    assert.ok(pool.length >= WORDS_PER_BATTLE);
  });

  check("5000 pool loads as a disjoint advanced set", () => {
    const words5000 = new Set(pool5000.map((w) => w.word));
    assert.equal(pool5000.length, words5000.size, "5000 pool has duplicates");
    for (const w of poolWords) {
      assert.ok(!words5000.has(w), `"${w}" is in both the 3000 and 5000 pools`);
    }
    assert.ok(pool5000.length > 0, "5000 pool is empty");
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
  // own stats; the room plays roomWordSet — both full halves interleaved and
  // capped at WORDS_PER_BATTLE, the exact shared set both players walk.
  // Guest join excludes the host's published words; a rematch excludes the
  // shared battle just played (each player's summary covers the shared room
  // word list).
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
      const merged = roomWordSet(host, guest);
      const union = new Set([...host, ...guest].map((w) => w.word)).size;
      assert.equal(
        merged.length,
        Math.min(union, WORDS_PER_BATTLE),
        "merged room set is short",
      );
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

  check("roomWordSet: exactly one 20-word shared set, interleaving both halves", () => {
    const host = pickBattleWords(pool, WORDS_PER_BATTLE, {});
    const guest = pickBattleWords(
      pool,
      WORDS_PER_BATTLE,
      {},
      host.map((w) => w.word),
    );
    const merged = roomWordSet(host, guest);
    assert.equal(
      merged.length,
      WORDS_PER_BATTLE,
      "shared set is not capped at the battle size",
    );
    assert.equal(
      new Set(merged.map((w) => w.word)).size,
      WORDS_PER_BATTLE,
      "duplicate in the shared set",
    );
    // Interleaved draw: with disjoint halves the shared set splits ~10/10 —
    // never one player's whole pick.
    const hostWords = new Set(host.map((w) => w.word));
    const hostShare = merged.filter((w) => hostWords.has(w.word)).length;
    assert.ok(
      hostShare >= 10,
      `interleave collapsed into one half (host share ${hostShare})`,
    );
  });

  // Infinite Tic-Tac-Toe board rules — the win condition both modes share.
  const placeSeq = (
    board: ReturnType<typeof createBoard>,
    moves: Move[],
    slot: SlotKey,
    cells: number[],
  ) => {
    let b = board;
    let m = moves;
    for (const cell of cells) {
      const res = applyPlacement(b, m, slot, cell, 0);
      assert.ok(res, `placement at ${cell} was rejected`);
      b = res!.board;
      m = res!.moves;
    }
    return { board: b, moves: m };
  };

  check("tictactoe: 3 in a row wins on every line", () => {
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8],
      [0, 3, 6], [1, 4, 7], [2, 5, 8],
      [0, 4, 8], [2, 4, 6],
    ];
    for (const line of lines) {
      const { board } = placeSeq(createBoard(), [], "p1", line);
      assert.equal(checkWinner(board), "X", `line ${line} did not win`);
    }
    assert.equal(checkWinner(createBoard()), null, "empty board has a winner");
    const { board: mixed } = placeSeq(createBoard(), [], "p1", [0, 4]);
    const { board: both } = placeSeq(mixed, [], "p2", [2, 5]);
    assert.equal(checkWinner(both), null, "scattered marks won");
  });

  check("tictactoe: a 4th placement fades the oldest mark", () => {
    const { board, moves } = placeSeq(createBoard(), [], "p1", [0, 1, 2, 3]);
    assert.equal(board[0], "", "oldest mark did not fade");
    assert.equal(board[3], "X", "newest mark missing");
    const onBoard = board.filter((c) => c === "X").length;
    assert.equal(onBoard, MARKS_PER_PLAYER, "a side holds more marks than allowed");
    // The next fade targets the oldest mark STILL ON THE BOARD, not the
    // already-faded cell the moves history starts with.
    assert.equal(nextToFade(board, moves, "p1"), 1, "fade highlight points at a faded cell");
    const { board: after5 } = placeSeq(board, moves, "p1", [4]);
    assert.equal(after5[1], "", "second-oldest mark did not fade");
    assert.equal(after5[4], "X", "fifth placement missing");
    // Occupied and out-of-range cells are rejected (PvP collision path).
    assert.equal(applyPlacement(after5, moves, "p2", 4, 0), null, "occupied cell accepted");
    assert.equal(applyPlacement(after5, moves, "p2", 9, 0), null, "out-of-range cell accepted");
  });

  check("tictactoe: bot takes a win, blocks a loss, plays a free cell", () => {
    // No fake wins: X at 0,1,5 — a naive copy of the board would call 2 a
    // winning cell (0,1,2), but the placement fades 0 and erases the line.
    // The bot must see no win and play any free cell.
    const twoInline = placeSeq(createBoard(), [], "p1", [0, 1, 5]);
    const pick = botPickCell(twoInline.board, twoInline.moves, "p1");
    assert.ok(pick != null && twoInline.board[pick] === "", "bot picked an occupied cell");
    // Genuine win: X at 3,4 with O elsewhere — 5 completes the middle row
    // and, with only two marks held, nothing fades.
    const winnable = placeSeq(createBoard(), [], "p2", [0, 8]);
    const { board: wb, moves: wm } = placeSeq(winnable.board, winnable.moves, "p1", [3, 4]);
    assert.equal(botPickCell(wb, wm, "p1"), 5, "bot missed a winning placement");
    // Block: O at 6,7 threatens 8 — and since O's oldest mark is 0, the
    // fade on 8 clears 0, not the threat, so 8 is a real loss to prevent.
    const blocking = placeSeq(createBoard(), [], "p2", [0, 6, 7]);
    assert.equal(botPickCell(blocking.board, blocking.moves, "p1"), 8, "bot missed a block");
    // Full board: no free cell, null.
    const full = createBoard().map(() => markFor("p1"));
    assert.equal(botPickCell(full, [], "p1"), null);
  });

  check("tictactoe: a placement needs 3 consecutive correct answers", () => {
    assert.equal(PLACEMENT_STREAK, 3, "streak gate changed without UI updates");
    const C = true, X = false, N = null;
    // Short runs earn nothing.
    assert.deepEqual(placementWords([]), []);
    assert.deepEqual(placementWords([C, C]), []);
    // A full run earns exactly one placement, at its completing word.
    assert.deepEqual(placementWords([C, C, C]), [2]);
    // A 6-run pays two; a miss resets the count mid-battle.
    assert.deepEqual(placementWords([C, C, C, C, C, C]), [2, 5]);
    assert.deepEqual(placementWords([C, C, X, C, C, C]), [5]);
    assert.deepEqual(placementWords([C, N, C, C, C]), [4]);
    assert.deepEqual(placementWords([C, C, N, C, C, C]), [5]);
    // Trailing-run counter: the latest miss zeroes it, a run after it counts alone.
    assert.equal(answerStreak([C, C, C, X], 4), 0);
    assert.equal(answerStreak([C, C, C, X, C], 5), 1);
    assert.equal(answerStreak([C, C, C], 3), 3);
    // The hold-deal decision: only a run-completing correct answer gates
    // the next word behind a placement.
    assert.equal(completesStreak([C, C], 2, true), true);
    assert.equal(completesStreak([C, C], 2, false), false);
    assert.equal(completesStreak([C, X], 2, true), false);
    assert.equal(completesStreak([C, C, C], 3, true), false);
    assert.equal(completesStreak([C, C, C, C, C], 5, true), true);
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
      pronounceURL: "",
      thai: `t${i}`,
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

  // The 2-option rule: a correct answer under 2s masters (ivl 14); anything
  // else — hesitated, guessed, wrong, timeout — is a retry due immediately.
  check("answers grade into the two pool marks", () => {
    const stats = saveWordResults([
      { word: "grade-instant", correct: true, ms: 1_500 },
      { word: "grade-slow", correct: true, ms: 2_500 },
      { word: "grade-blank", correct: true, ms: 5_500 },
      { word: "grade-timeout", correct: false, ms: 10_000, timeout: true },
      { word: "grade-wrong-fast", correct: false, ms: 1_200 },
    ]);
    assert.equal(stats["grade-instant"].mark, "instant");
    assert.equal(stats["grade-instant"].ivl, 14);
    assert.equal(stats["grade-slow"].mark, "retry");
    assert.equal(stats["grade-slow"].ivl, 0);
    assert.equal(stats["grade-blank"].mark, "retry");
    assert.equal(stats["grade-blank"].ivl, 0);
    assert.equal(stats["grade-timeout"].mark, "retry");
    assert.equal(stats["grade-wrong-fast"].mark, "retry");
    assert.equal(stats["grade-wrong-fast"].ivl, 0);
  });

  // 1:2 interleaved draw: with plentiful pools every 3-word cycle deals
  // exactly 1 new + 2 old, so count 30 must split 10/20.
  check("1:2 rule: plentiful pools yield 1 new : 2 old", () => {
    const now = Date.now();
    const stats: WordStats = {};
    pool.slice(0, 300).forEach((w) => {
      stats[w.word] = { seen: 1, correct: 0, wrong: 1, lastSeenAt: now - 3 * DAY_MS, ivl: 0, mark: "retry" };
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
      stats[w.word] = { seen: 2, correct: 1, wrong: 1, lastSeenAt: now - 3 * DAY_MS, ivl: 0, mark: "retry" };
    });
    pool.slice(400, 800).forEach((w) => {
      stats[w.word] = { seen: 2, correct: 2, wrong: 0, lastSeenAt: now - 30 * DAY_MS, ivl: 14, mark: "instant" };
    });
    let fromB = 0;
    let fromC = 0;
    for (let i = 0; i < 150; i++) {
      for (const w of pickBattleWords(pool, 30, stats)) {
        const mark = stats[w.word]?.mark;
        if (mark === "retry") fromB++;
        else if (mark === "instant") fromC++;
      }
    }
    const share = fromB / (fromB + fromC);
    assert.ok(
      share > 0.55 && share < 0.8,
      `Pool B share ${(share * 100).toFixed(1)}% outside the 2:1 band (B=${fromB}, C=${fromC})`,
    );
  });

  // Retry words (ivl 0) are active review: they are due immediately and
  // bypass the 30-min session cooldown, even when every mastered word is
  // still inside it.
  check("retry words return immediately despite the session cooldown", () => {
    const now = Date.now();
    const stats: WordStats = {};
    pool.slice(0, 100).forEach((w) => {
      stats[w.word] = { seen: 1, correct: 1, wrong: 0, lastSeenAt: now - 5 * 60_000, ivl: 14, mark: "instant" };
    });
    const retry = pool[0];
    stats[retry.word] = { seen: 1, correct: 0, wrong: 1, lastSeenAt: now - 5 * 60_000, ivl: 0, mark: "retry" };
    const words = pickBattleWords(pool, WORDS_PER_BATTLE, stats);
    assert.ok(
      words.some((w) => w.word === retry.word),
      "retry word was not dealt despite being due for active review",
    );
  });

  // Review draw is least-recently-seen first: after a battle deals its cohort,
  // those words are the newest of the queue, so the next battles cycle the
  // still-undone due words before re-dealing any of them. The old uniform
  // random draw clumped the same words into back-to-back battles instead.
  check("review draw cycles the due queue before repeating a word", () => {
    const now = Date.now();
    const cohort = pool.slice(100, 140); // 40 due retry words
    const stats: WordStats = {};
    cohort.forEach((w) => {
      stats[w.word] = { seen: 1, correct: 0, wrong: 1, lastSeenAt: now - 3 * DAY_MS, ivl: 0, mark: "retry" };
    });
    const dealt = new Map<string, number>();
    const deal = (prev: string[]) => {
      const words = pickBattleWords(pool, WORDS_PER_BATTLE, stats, prev);
      const names: string[] = [];
      for (const w of words) {
        names.push(w.word);
        if (!cohort.some((c) => c.word === w.word)) continue;
        dealt.set(w.word, (dealt.get(w.word) ?? 0) + 1);
        // Dealt words are saved as just-answered, i.e. the newest of the queue.
        stats[w.word] = { ...stats[w.word], lastSeenAt: now };
      }
      return names;
    };
    const first = deal([]);
    assert.ok(
      first.length >= 10,
      "due review words were not dealt despite an all-retry cohort",
    );
    const second = deal(first);
    const third = deal(second);
    assert.ok(
      third.some((w) => cohort.some((c) => c.word === w)),
      "the queue had untouched due words but battle 3 dealt none",
    );
    for (const [word, n] of dealt) {
      assert.equal(n, 1, `"${word}" was re-dealt before the due queue cycled`);
    }
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
