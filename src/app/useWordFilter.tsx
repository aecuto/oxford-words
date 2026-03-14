import { useState, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";

export const FILTER_OPTIONS = [
  "verb",
  "adjective",
  "noun",
  "adverb",
  "other",
] as const;

export const LIST_OPTIONS = [
  "Oxford 3000",
  "Oxford 5000 excluding Oxford 3000",
] as const;

export type FilterOption = (typeof FILTER_OPTIONS)[number];
export type ListOption = (typeof LIST_OPTIONS)[number];

export function useWordFilter() {
  const [filter, setFilter] = useState<FilterOption>("verb");
  const [list, setList] = useState<ListOption>("Oxford 3000");
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const words = useLiveQuery(async () => {
    const ox3000 = list === LIST_OPTIONS[0];

    return db.words
      .filter((word) => {
        const typeMatch =
          filter === "other"
            ? !["verb", "adjective", "noun", "adverb"].includes(word.type)
            : word.type === filter;

        return word.ox3000 === ox3000 && !word.ok && typeMatch;
      })
      .toArray();
  }, [filter, list, refreshKey]);

  return { filter, setFilter, list, setList, words, refresh };
}
