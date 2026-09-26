import { create } from "zustand";
import type { DailyProgress } from "../../game/wordProgress";
import type { Progress } from "../../game/progressService";

type ProgressState = {
  poolTotal: number;
  counts: { seen: number; mastered: number };
  record: Progress | null;
  daily: DailyProgress | null;
  setPoolTotal: (poolTotal: number) => void;
  setCounts: (counts: { seen: number; mastered: number }) => void;
  setRecord: (record: Progress | null) => void;
  setDaily: (daily: DailyProgress | null) => void;
};

export const useProgressStore = create<ProgressState>()((set) => ({
  poolTotal: 0,
  counts: { seen: 0, mastered: 0 },
  record: null,
  daily: null,
  setPoolTotal: (poolTotal) => set({ poolTotal }),
  setCounts: (counts) => set({ counts }),
  setRecord: (record) => set({ record }),
  setDaily: (daily) => set({ daily }),
}));
