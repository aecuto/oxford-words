import { useState, useCallback } from "react";
import { sampleSize, shuffle, flatMap, uniq } from "lodash";
import { Word, db } from "./db";

// ─── Types ────────────────────────────────────────────────────────────────────

type AnswerState = "idle" | "correct" | "wrong";

type WordRound = {
  word: Word;
  correct: boolean | null;
  answers: string[];
};

type RoundState = {
  pool: Word[];
  queue: WordRound[];
  currentIdx: number;
  correctCount: number;
  answers: string[];
  selectedAnswer: string | null;
  answerState: AnswerState;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const ROUND_SIZE = 10;
const ANSWER_COUNT = 6;
const FLASH_MS = 800;

const INITIAL_STATE: RoundState = {
  pool: [],
  queue: [],
  currentIdx: 0,
  correctCount: 0,
  answers: [],
  selectedAnswer: null,
  answerState: "idle",
};

// ─── Audio ────────────────────────────────────────────────────────────────────

let currentAudio: HTMLAudioElement | null = null;

function playSound(word: Word) {
  if (!word?.pronounce) return;
  currentAudio?.pause();
  currentAudio = new Audio(word.pronounce);
  currentAudio.play().catch(() => {});
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

const IS_DEV = process.env.NODE_ENV === "development";

function buildAnswers(current: Word, pool: Word[]): string[] {
  const correct = getCorrectAnswer(current);
  const wrong = pool
    .filter((w) => w.id !== current.id)
    .map(getCorrectAnswer)
    .filter((a) => a && a !== correct);
  const correctAnswer = IS_DEV ? correct + "___" : correct;
  return shuffle([correctAnswer, ...sampleSize(wrong, ANSWER_COUNT - 1)]);
}

function buildQueue(words: Word[], pool: Word[]): WordRound[] {
  return words.map((word) => ({
    word,
    correct: null,
    answers: buildAnswers(word, pool),
  }));
}

// ─── advance helper ───────────────────────────────────────────────────────────

function advance(queue: WordRound[], pool: Word[], nextIdx: number) {
  const allDone = nextIdx >= queue.length;

  if (allDone) {
    queue.forEach((r) => db.words.update(Number(r.word.id), { ok: true }));
    return (p: RoundState): RoundState => ({
      ...p,
      currentIdx: nextIdx,
      answerState: "idle",
    });
  }

  const next = queue[nextIdx];
  playSound(next.word);
  return (p: RoundState): RoundState => ({
    ...p,
    currentIdx: nextIdx,
    selectedAnswer: null,
    answerState: "idle",
    answers: next.answers,
  });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useVocabRound() {
  const [state, setState] = useState<RoundState>(INITIAL_STATE);

  const setup = useCallback((pool: Word[]) => {
    if (pool.length < ROUND_SIZE) return;
    const words = sampleSize(pool, ROUND_SIZE);
    const queue = buildQueue(words, pool);
    setState({
      ...INITIAL_STATE,
      pool,
      queue,
      answers: queue[0].answers,
    });
    playSound(queue[0].word);
  }, []);

  const currentWord = state.queue[state.currentIdx]?.word;

  const selectAnswer = useCallback(
    (answer: string) => {
      if (!currentWord || state.answerState !== "idle") return;

      const normalize = (a: string) => a.replace(/___$/, "");
      const isCorrect =
        normalize(answer) === normalize(getCorrectAnswer(currentWord));

      setState((s) => {
        const updatedQueue = s.queue.map((r, i) =>
          i === s.currentIdx ? { ...r, correct: isCorrect } : r,
        );

        // Re-insert wrong word right after current position
        if (!isCorrect) {
          const wrongRound: WordRound = {
            ...updatedQueue[s.currentIdx],
            correct: null,
            answers: buildAnswers(updatedQueue[s.currentIdx].word, s.pool),
          };
          updatedQueue.splice(s.currentIdx + 1, 0, wrongRound);
        }

        const nextIdx = s.currentIdx + 1;

        // Use functional update so advance reads the latest queue (with splice)
        setTimeout(
          () => setState((p) => advance(p.queue, p.pool, nextIdx)(p)),
          FLASH_MS,
        );

        return {
          ...s,
          selectedAnswer: answer,
          answerState: (isCorrect ? "correct" : "wrong") as AnswerState,
          correctCount: isCorrect ? s.correctCount + 1 : s.correctCount,
          queue: updatedQueue,
        };
      });
    },
    [currentWord, state.answerState],
  );

  return {
    currentWord,
    answers: state.answers,
    selectedAnswer: state.selectedAnswer,
    answerState: state.answerState,
    progress: { current: state.correctCount, total: ROUND_SIZE },
    setup,
    selectAnswer,
  };
}
