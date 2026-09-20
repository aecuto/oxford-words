"use client";

import { useEffect, useState } from "react";
import { isSfxMuted, onSfxMuteChange, setSfxMuted } from "../../../lib/sfx";

export function SoundToggle() {
  const [muted, setMuted] = useState(isSfxMuted);

  useEffect(() => onSfxMuteChange(setMuted), []);

  return (
    <button
      onClick={() => setSfxMuted(!muted)}
      aria-label={muted ? "Unmute sound effects" : "Mute sound effects"}
      title={muted ? "Sound off" : "Sound on"}
      className="w-8 h-8 shrink-0 rounded-full text-base leading-none border border-gray-300 dark:border-gray-600 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors"
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
