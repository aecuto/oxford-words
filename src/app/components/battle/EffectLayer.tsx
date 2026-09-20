"use client";

import { useEffect, useRef, useState } from "react";
import type { Popup } from "../../../game/types";

type EffectLayerProps = {
  popups: Popup[];
};

export function useCritEffects(popups: Popup[]) {
  const [active, setActive] = useState(false);
  const seenIds = useRef<Set<number>>(new Set());
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const newCrit = popups.find((p) => p.crit && !seenIds.current.has(p.id));
    if (!newCrit) return;
    seenIds.current.add(newCrit.id);
    setActive(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setActive(false);
    }, 500);
  }, [popups]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    []
  );

  return { shake: active, flash: active };
}

export function FlashOverlay({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="fixed inset-0 z-40 pointer-events-none bg-orange-300 dark:bg-orange-500 animate-flash" />
  );
}
