"use client";

import { cx } from "@emotion/css";
import type { Popup } from "../../../game/types";

type DamagePopupProps = {
  popup: Popup;
  flip?: boolean;
};

export function DamagePopup({ popup, flip = false }: DamagePopupProps) {
  return (
    <div
      key={popup.id}
      className={cx(
        "absolute -top-7 z-20 pointer-events-none animate-floatUp font-black",
        flip ? "right-2" : "left-2",
        popup.crit
          ? "text-3xl text-orange-400 drop-shadow-[0_2px_0_rgba(0,0,0,0.6)]"
          : "text-2xl text-red-500 dark:text-red-400 drop-shadow-[0_2px_0_rgba(0,0,0,0.5)]"
      )}
    >
      {popup.crit && (
        <>
          <span className="absolute -inset-2 rounded-full border-2 border-yellow-300/80 animate-critRing pointer-events-none" />
          <span className="block text-[10px] tracking-widest text-yellow-300">
            CRITICAL
          </span>
        </>
      )}{" "}
      -{popup.damage}
    </div>
  );
}
