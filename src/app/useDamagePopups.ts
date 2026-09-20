"use client";

import { useCallback, useState } from "react";
import type { Popup } from "../game/types";
import { POPUP_LIFETIME_MS } from "../lib/gameConfig";

export function useDamagePopups() {
  const [popups, setPopups] = useState<Popup[]>([]);

  const spawnPopup = useCallback(
    (side: Popup["side"], damage: number, crit: boolean) => {
      const popup: Popup = { id: Date.now() + Math.random(), side, damage, crit };
      setPopups((prev) => [...prev.slice(-4), popup]);
      window.setTimeout(() => {
        setPopups((prev) => prev.filter((p) => p.id !== popup.id));
      }, POPUP_LIFETIME_MS);
    },
    []
  );

  const clearPopups = useCallback(() => setPopups([]), []);

  return { popups, spawnPopup, clearPopups } as const;
}
