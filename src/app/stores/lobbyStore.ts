import { create } from "zustand";
import type { ClientRoom, OpenRoom, ResultOutcome } from "../../game/types";
import type { WordList } from "../../lib/gameConfig";

// Last solo result from sessionStorage — a personal hook to replay the bot.
export type LobbyLastSolo = {
  outcome: ResultOutcome;
  correct: number;
  answered: number;
};

type LobbyState = {
  busy: "create" | null;
  error: string | null;
  openRooms: OpenRoom[] | null;
  myUid: string | null;
  myRoomCode: string | null;
  myRoom: ClientRoom | null;
  lastSolo: LobbyLastSolo | null;
  // Active word list (3000/5000), read after mount so the hydrated render
  // matches SSR; flows into ProgressPanel so its counts refresh on a switch.
  wordList: WordList;
  setBusy: (busy: "create" | null) => void;
  setError: (error: string | null) => void;
  setOpenRooms: (openRooms: OpenRoom[] | null) => void;
  setMyUid: (uid: string | null) => void;
  setMyRoomCode: (code: string | null) => void;
  setMyRoom: (room: ClientRoom | null) => void;
  setLastSolo: (lastSolo: LobbyLastSolo | null) => void;
  setWordList: (list: WordList) => void;
};

export const useLobbyStore = create<LobbyState>()((set) => ({
  busy: null,
  error: null,
  openRooms: null,
  myUid: null,
  myRoomCode: null,
  myRoom: null,
  lastSolo: null,
  wordList: "3000",
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error }),
  setOpenRooms: (openRooms) => set({ openRooms }),
  setMyUid: (myUid) => set({ myUid }),
  setMyRoomCode: (myRoomCode) => set({ myRoomCode }),
  setMyRoom: (myRoom) => set({ myRoom }),
  setLastSolo: (lastSolo) => set({ lastSolo }),
  setWordList: (wordList) => set({ wordList }),
}));
