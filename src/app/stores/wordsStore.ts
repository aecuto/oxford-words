import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { WordStat } from "../../game/wordProgress";

export type WordFilter = "learning" | "mastered";

export type ListedWord = {
  word: string;
  pronounceURL: string;
  type: string;
  level: string;
  thai: string;
  stat: WordStat;
};

type WordsPageState = {
  filter: WordFilter;
  words: ListedWord[] | null;
  // Clock captured once at load time; due countdowns don't need to tick live.
  loadedAt: number;
  setFilter: (filter: WordFilter) => void;
  setWords: (words: ListedWord[] | null) => void;
  setLoadedAt: (loadedAt: number) => void;
};

// Only the chosen tab is worth remembering across visits — the word data
// itself is always refetched from the pool + SRS stats on mount. The word
// list choice (3000/5000) is persisted separately by src/game/wordList.ts,
// which every pool reader follows.
export const useWordsStore = create<WordsPageState>()(
  persist(
    (set) => ({
      filter: "learning",
      words: null,
      loadedAt: 0,
      setFilter: (filter) => set({ filter }),
      setWords: (words) => set({ words }),
      setLoadedAt: (loadedAt) => set({ loadedAt }),
    }),
    {
      name: "words:filter:v1",
      storage: createJSONStorage(() => localStorage),
      // Rehydrated in the page's mount effect — the same after-mount pattern
      // as every other localStorage read — so the SSR render stays
      // predictable and a ?filter= deep link can still win.
      skipHydration: true,
      partialize: (state) => ({ filter: state.filter }),
    }
  )
);
