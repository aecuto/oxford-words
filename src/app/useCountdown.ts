"use client";

import { useEffect, useState } from "react";

export function useCountdown(
  startMs: number | null,
  durationMs: number
): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startMs === null) return;
    let raf = 0;
    const tick = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [startMs]);

  if (startMs === null) return durationMs;
  return Math.max(0, durationMs - (now - startMs));
}
