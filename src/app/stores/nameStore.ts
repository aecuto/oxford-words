"use client";

import { create } from "zustand";

const NAME_KEY = "battle:name";

function readStoredName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

type NameState = {
  // The player's display name. Hydrated from localStorage by sync() — pages
  // call it once on mount so the SSR render (empty string) stays consistent;
  // storage failures fail soft to the empty name.
  name: string;
  sync: () => void;
  saveName: (value: string) => void;
};

export const useNameStore = create<NameState>()((set) => ({
  name: "",
  sync: () => set({ name: readStoredName() }),
  saveName: (value) => {
    try {
      localStorage.setItem(NAME_KEY, value);
    } catch {
      // storage unavailable; the name lives only for this session's UI
    }
    set({ name: value });
  },
}));
