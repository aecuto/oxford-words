import { create } from "zustand";
import type { DailyProgress } from "../../game/wordProgress";
import type { BattleSummary } from "../../game/battleSummary";

type ResultState = {
  summary: BattleSummary | null;
  daily: DailyProgress | null;
  creating: boolean;
  createError: string | null;
  setSummary: (summary: BattleSummary | null) => void;
  setDaily: (daily: DailyProgress | null) => void;
  setCreating: (creating: boolean) => void;
  setCreateError: (error: string | null) => void;
};

export const useResultStore = create<ResultState>()((set) => ({
  summary: null,
  daily: null,
  creating: false,
  createError: null,
  setSummary: (summary) => set({ summary }),
  setDaily: (daily) => set({ daily }),
  setCreating: (creating) => set({ creating }),
  setCreateError: (createError) => set({ createError }),
}));
