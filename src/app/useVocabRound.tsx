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

async function loadRoundState(): Promise<{
  current: CurrentRound | null;
  correctCount: number;
  total: number;
}> {
  const [current, correctCount, total] = await Promise.all([
    getNextPending(),
    getCorrectCount(),
    getTotalOriginal(),
  ]);
  return { current, correctCount, total };
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

  const filteredEntries = entryType
    ? entries.filter((e) => e.type.startsWith(entryType))
    : entries;

  const thaiTranslations = uniq(flatMap(filteredEntries, (e) => e.thai ?? []));

  // Take up to 3 translations
  if (thaiTranslations.length > 0) {
    return thaiTranslations.slice(0, 3).join(", ");
  }

  // Fallback: first Thai translation from any entry
  return entries.flatMap((e) => e.thai ?? [])[0] || "";
}

function buildAnswers(current: Word, pool: Word[]): string[] {
  const correct = getCorrectAnswer(current);
  const distractors = pool
    .filter((w) => w.id !== current.id)
    .map(getCorrectAnswer)
    .filter((a) => a && a !== correct);
  return shuffle([correct, ...sampleSize(distractors, ANSWER_COUNT - 1)]);
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
        const roundState = await loadRoundState();
        setState({ ...INITIAL_STATE, ...roundState });
      }
      setHydrated(true);
    })();
  }, []);

  // ── Setup ───────────────────────────────────────────────────────────────────
  const setup = useCallback(async (words: Word[]) => {
    if (words.length < ROUND_SIZE) return;
    setPool(words);

    if (await hasActiveRound()) {
      const roundState = await loadRoundState();
      setState({ ...INITIAL_STATE, ...roundState });
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

  // ── Next word ───────────────────────────────────────────────────────────────
  const nextWord = useCallback(async () => {
    const next = await getNextPending();

    if (!next) {
      // Round complete: mark all words as learned
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
  }, []);

  // ── Select answer ───────────────────────────────────────────────────────────
  const selectAnswer = useCallback(
    async (answer: string) => {
      const { current, answerState } = state;
      if (!current || answerState !== "idle") return;

      const correct = getCorrectAnswer(current.word);
      const isCorrect = answer === correct;

      if (isCorrect) {
        await db.rounds.update(current.id!, { correct: true });
      } else {
        // Wrong answer: reschedule with new answers
        await db.rounds.update(current.id!, {
          correct: null,
          order: Date.now(),
          answers: buildAnswers(current.word, pool),
        });
      }

      const newAnswerState: AnswerState = isCorrect ? "correct" : "wrong";
      const newCorrectCount = isCorrect ? state.correctCount + 1 : state.correctCount;

      setState((s) => ({
        ...s,
        selectedAnswer: answer,
        answerState: newAnswerState,
        correctCount: newCorrectCount,
      }));

      // Auto next if correct
      if (isCorrect) {
        setTimeout(() => nextWord(), FLASH_MS);
      }
    },
    [state, pool, nextWord],
  );

  return {
    currentWord: state.current?.word ?? null,
    answers: state.current?.answers ?? [],
    correctAnswer: state.current ? getCorrectAnswer(state.current.word) : null,
    selectedAnswer: state.selectedAnswer,
    answerState: state.answerState,
    progress: { current: state.correctCount, total: state.total },
    hydrated,
    hasSavedRound: state.current !== null,
    setup,
    resetRound,
    selectAnswer,
    nextWord,
  };
}
