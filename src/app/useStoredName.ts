"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

const NAME_KEY = "battle:name";

const emptySubscribe = () => () => {};

export function useStoredName() {
  const [override, setOverride] = useState<string | null>(null);
  const storedName = useSyncExternalStore(
    emptySubscribe,
    () => localStorage.getItem(NAME_KEY) ?? "",
    () => ""
  );
  const name = override ?? storedName;

  const saveName = useCallback((value: string) => {
    setOverride(value);
    localStorage.setItem(NAME_KEY, value);
  }, []);

  return { name, saveName } as const;
}
