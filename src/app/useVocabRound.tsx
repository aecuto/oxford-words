import { useState, useCallback } from "react";
import { sampleSize, shuffle, orderBy, take, uniq } from "lodash";
import _ from "lodash";
import { Word, db } from "./db";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GroupEntry = { cat: string; text: string };

export type Group = {
  entries: GroupEntry[];
  correctForWordIdx: number | null;
  type: string;
};

type FlashState = "correct" | "wrong" | null;

type RoundState = {
  words: [Word | undefined, Word | undefined];
  groups: Group[];
  selectedWordIdx: number | null;
  matchedWords: [boolean, boolean];
  groupFlash: FlashState[];
  lockedGroups: [number | null, number | null];
};

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_ENTRIES = 4;
const WRONG_GROUPS_PER_WORD = 2;
const FLASH_MS = 800;

const INITIAL_STATE: RoundState = {
  words: [undefined, undefined],
  groups: [],
  selectedWordIdx: null,
  matchedWords: [false, false],
  groupFlash: Array(6).fill(null),
  lockedGroups: [null, null],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Replace one value in a tuple by index
function setAt<T>(arr: T[], idx: number, val: T): T[] {
  return arr.map((v, i) => (i === idx ? val : v));
}

// Merge a new Set from an existing one + extra strings
function mergeSet(base: Set<string>, extra: string[]): Set<string> {
  return new Set<string>(uniq(Array.from(base).concat(extra)));
}

// ─── Group builders ───────────────────────────────────────────────────────────

function getWordType(word: Word): string {
  return word.entries?.[0]?.type ?? word.type ?? "";
}

function toEntries(word: Word, type: string): GroupEntry[] {
  return _(word.entries ?? [])
    .filter((e) => e.type === type && !!e.thai?.length)
    .flatMap((e) =>
      take(e.thai!, MAX_ENTRIES).map((text) => ({ cat: e.type, text })),
    )
    .value();
}

function buildCorrectGroup(word: Word): GroupEntry[] {
  return _(word.entries ?? [])
    .filter((e) => !!e.thai?.length)
    .flatMap((e) =>
      take(e.thai!, MAX_ENTRIES).map((text) => ({ cat: e.type, text })),
    )
    .take(MAX_ENTRIES)
    .value();
}

function buildWrongGroups(
  pool: Word[],
  excluded: Set<string>,
  type: string,
): GroupEntry[][] {
  const used = new Set<string>(Array.from(excluded));
  const groups: GroupEntry[][] = [];

  for (const word of orderBy(pool, (w) =>
    toEntries(w, type).length > 0 ? 0 : 1,
  )) {
    if (groups.length >= WRONG_GROUPS_PER_WORD) break;
    const candidates = toEntries(word, type).filter((e) => !used.has(e.text));
    if (!candidates.length) continue;
    const group = take(candidates, MAX_ENTRIES);
    group.forEach((e) => used.add(e.text));
    groups.push(group);
  }

  return groups;
}

function buildGroups(words: [Word, Word], pool: Word[]): Group[] {
  const [word0, word1] = words;
  const [type0, type1] = words.map(getWordType) as [string, string];
  const [correct0, correct1] = words.map(buildCorrectGroup) as [
    GroupEntry[],
    GroupEntry[],
  ];

  const others = pool.filter((w) => w.id !== word0.id && w.id !== word1.id);
  const correctTexts = mergeSet(
    new Set(),
    correct0.concat(correct1).map((e) => e.text),
  );

  const wrongFor0 = buildWrongGroups(others, correctTexts, type0);
  const wrongFor1 = buildWrongGroups(
    others,
    mergeSet(
      correctTexts,
      wrongFor0.flatMap((g) => g.map((e) => e.text)),
    ),
    type1,
  );

  const toGroup = (
    entries: GroupEntry[],
    correctForWordIdx: number | null,
    type: string,
  ): Group => ({ entries, correctForWordIdx, type });

  return shuffle([
    toGroup(correct0, 0, type0),
    toGroup(correct1, 1, type1),
    ...wrongFor0.map((e) => toGroup(e, null, type0)),
    ...wrongFor1.map((e) => toGroup(e, null, type1)),
  ]);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useVocabRound() {
  const [state, setState] = useState<RoundState>(INITIAL_STATE);

  const setup = useCallback((pool: Word[]) => {
    if (pool.length < 2) return;
    const words = sampleSize(pool, 2) as [Word, Word];
    setState({ ...INITIAL_STATE, words, groups: buildGroups(words, pool) });
  }, []);

  const selectWord = useCallback(
    (idx: number) => {
      setState((s) => {
        if (s.matchedWords[idx]) return s;
        return { ...s, selectedWordIdx: idx };
      });
      const word = state.words[idx];
      if (word?.pronounce) new Audio(word.pronounce).play().catch(() => {});
    },
    [state.words, state.matchedWords],
  );

  const selectGroup = useCallback((groupIdx: number) => {
    setState((s) => {
      if (s.selectedWordIdx === null || s.lockedGroups.includes(groupIdx))
        return s;

      const isCorrect =
        s.groups[groupIdx]?.correctForWordIdx === s.selectedWordIdx;

      if (!isCorrect) {
        setTimeout(
          () =>
            setState((p) => ({
              ...p,
              groupFlash: setAt(p.groupFlash, groupIdx, null),
            })),
          FLASH_MS,
        );
        return {
          ...s,
          groupFlash: setAt(s.groupFlash, groupIdx, "wrong") as FlashState[],
        };
      }

      const matchedWords = setAt(s.matchedWords, s.selectedWordIdx, true) as [
        boolean,
        boolean,
      ];
      if (matchedWords.every(Boolean)) {
        setTimeout(
          () =>
            s.words.forEach(
              (w) => w && db.words.update(Number(w.id), { ok: true }),
            ),
          FLASH_MS,
        );
      }

      return {
        ...s,
        selectedWordIdx: null,
        matchedWords,
        lockedGroups: setAt(s.lockedGroups, s.selectedWordIdx, groupIdx) as [
          number | null,
          number | null,
        ],
        groupFlash: setAt(s.groupFlash, groupIdx, "correct") as FlashState[],
      };
    });
  }, []);

  return { ...state, setup, selectWord, selectGroup };
}
