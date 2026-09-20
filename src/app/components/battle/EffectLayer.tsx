"use client";

import { useEffect, useState } from "react";
import type { Popup } from "../../../game/types";

type EffectLayerProps = {
  popups: Popup[];
};

export function useCritEffects(popups: Popup[]) {
  const [shake, setShake] = useState(false);
  const [flash, setFlash] = useState(false);
  const [seenIds, setSeenIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    const newCrit = popups.find((p) => p.crit && !seenIds.has(p.id));
    if (!newCrit) return;
    setSeenIds((prev) => new Set(prev).add(newCrit.id));
    setShake(true);
    setFlash(true);
    const t = window.setTimeout(() => {
      setShake(false);
      setFlash(false);
    }, 500);
    return () => window.clearTimeout(t);
  }, [popups, seenIds]);

  return { shake, flash };
}

export function FlashOverlay({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="fixed inset-0 z-40 pointer-events-none bg-orange-300 dark:bg-orange-500 animate-flash" />
  );
}
