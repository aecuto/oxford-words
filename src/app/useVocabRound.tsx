import { useState, useCallback, useEffect } from "react";
import { sampleSize, shuffle, flatMap, uniq } from "lodash";
import { Word, RoundRow, db, CurrentRound } from "./db";

// ─── Types ────────────────────────────────────────────────────────────────────

type AnswerState = "idle" | "correct" | "wrong";

type RoundState = {
  current: CurrentRound | null; // was RoundRow
  correctCount: number;
  total: number;
  selectedAnswer: string | null;
  answerState: AnswerState;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const ROUND_SIZE = 10;
const ANSWER_COUNT = 6;
const FLASH_MS = 800;
const IS_DEV = process.env.NODE_ENV === "development";

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function joinWord(row: RoundRow): Promise<CurrentRound | null> {
  const word = await db.words.get(row.wordId);
  if (!word) return null;
  return { ...row, word };
}

async function getNextPending(): Promise<CurrentRound | null> {
  const row = await db.rounds
    .orderBy("order")
    .filter((r) => r.correct === null)
    .first();
  if (!row) return null;
  return joinWord(row);
}

async function getCorrectCount(): Promise<number> {
  return db.rounds.filter((r) => r.correct === true).count();
}

async function getTotalOriginal(): Promise<number> {
  return db.rounds.count();
}

async function clearRounds(): Promise<void> {
  await db.rounds.clear();
}

async function hasActiveRound(): Promise<boolean> {
  const pending = await db.rounds.filter((r) => r.correct === null).count();
  return pending > 0;
}

// ─── Answer helpers ───────────────────────────────────────────────────────────

const typeMap: Record<string, string> = {
  noun: "N",
  verb: "V",
  adjective: "ADJ",
  adverb: "ADV",
};

function getCorrectAnswer(word: Word): string {
  const entryType = typeMap[word.type];
  const entries = word.entries ?? [];
  const filtered = entryType
    ? entries.filter((e) => e.type.startsWith(entryType))
    : entries;
  const result = uniq(flatMap(filtered, (e) => e.thai ?? []))
    .slice(0, 3)
    .join(", ");
  return result || entries.flatMap((e) => e.thai ?? []).at(0) || "";
}

function buildAnswers(current: Word, pool: Word[]): string[] {
  const correct = getCorrectAnswer(current);
  const distractors = pool
    .filter((w) => w.id !== current.id)
    .map(getCorrectAnswer)
    .filter((a) => a && a !== correct);
  const correctAnswer = IS_DEV ? correct + "___" : correct;
  return shuffle([correctAnswer, ...sampleSize(distractors, ANSWER_COUNT - 1)]);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const INITIAL_STATE: RoundState = {
  current: null,
  correctCount: 0,
  total: ROUND_SIZE,
  selectedAnswer: null,
  answerState: "idle",
};

export function useVocabRound() {
  const [state, setState] = useState<RoundState>(INITIAL_STATE);
  const [pool, setPool] = useState<Word[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // ── Rehydrate on mount ──────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const active = await hasActiveRound();
      if (active) {
        const [current, correctCount, total] = await Promise.all([
          getNextPending(),
          getCorrectCount(),
          getTotalOriginal(),
        ]);
        setState({ ...INITIAL_STATE, current, correctCount, total });
      }
      setHydrated(true);
    })();
  }, []);

  // ── Setup ───────────────────────────────────────────────────────────────────
  const setup = useCallback(async (words: Word[]) => {
    if (words.length < ROUND_SIZE) return;
    setPool(words);

    if (await hasActiveRound()) {
      const [current, correctCount, total] = await Promise.all([
        getNextPending(),
        getCorrectCount(),
        getTotalOriginal(),
      ]);
      setState({ ...INITIAL_STATE, current, correctCount, total });
      setHydrated(true);
      return;
    }

    const selected = sampleSize(words, ROUND_SIZE);
    await clearRounds();
    await db.rounds.bulkAdd(
      selected.map((word, i) => ({
        wordId: Number(word.id), // no word object — just the id
        correct: null,
        answers: buildAnswers(word, words),
        order: i,
      })),
    );

    const current = await getNextPending();
    setState({ ...INITIAL_STATE, current, total: ROUND_SIZE });
    setHydrated(true);
  }, []);

  // ── Reset ───────────────────────────────────────────────────────────────────
  const resetRound = useCallback(async () => {
    await clearRounds();
    setState(INITIAL_STATE);
  }, []);

  // ── Select answer ───────────────────────────────────────────────────────────
  const selectAnswer = useCallback(
    async (answer: string) => {
      const { current, answerState } = state;
      if (!current || answerState !== "idle") return;

      const normalize = (a: string) => a.replace(/___$/, "");
      const isCorrect =
        normalize(answer) === normalize(getCorrectAnswer(current.word));

      await db.rounds.update(current.id!, {
        correct: isCorrect ? true : null,
        ...(isCorrect
          ? {}
          : {
              order: Date.now(),
              answers: buildAnswers(current.word, pool),
            }),
      });

      setState((s) => ({
        ...s,
        selectedAnswer: answer,
        answerState: isCorrect ? "correct" : "wrong",
        correctCount: isCorrect ? s.correctCount + 1 : s.correctCount,
      }));

      setTimeout(async () => {
        const next = await getNextPending();

        if (!next) {
          const all = await db.rounds.toArray();
          await Promise.all(
            all.map((r) => db.words.update(r.wordId, { ok: true })),
          );
          await clearRounds();
          setState(INITIAL_STATE);
          return;
        }

        setState((s) => ({
          ...s,
          current: next,
          selectedAnswer: null,
          answerState: "idle",
        }));
      }, FLASH_MS);
    },
    [state, pool],
  );

  return {
    currentWord: state.current?.word ?? null,
    answers: state.current?.answers ?? [],
    selectedAnswer: state.selectedAnswer,
    answerState: state.answerState,
    progress: { current: state.correctCount, total: state.total },
    hydrated,
    hasSavedRound: state.current !== null,
    setup,
    resetRound,
    selectAnswer,
  };
}
