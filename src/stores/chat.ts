// The companion's chat: the input's state and what the speech queue has on screen. The turn
// itself and the history live in the core; see `@/windows/companion/chat`.

import { create } from "zustand";
import type { Segment } from "@/audio/speechQueue";
import type { ChatStatus } from "@/ipc";

interface ChatState {
  /** Whether chat has a provider; undefined until the first read. */
  status: ChatStatus | undefined;
  inputOpen: boolean;
  /** Bumped to move focus to the input, e.g. by the hotkey while it is already open. */
  focusRequest: number;
  /** A reply is on its way and nothing of it is on screen yet. */
  waiting: boolean;
  subtitle: Segment | null;
  /** Why the last message or reply failed, shown by the input. */
  notice: string | null;
  openInput: () => void;
  closeInput: () => void;
}

export const useChatStore = create<ChatState>()((set) => ({
  status: undefined,
  inputOpen: false,
  focusRequest: 0,
  waiting: false,
  subtitle: null,
  notice: null,
  openInput: () => set((state) => ({ inputOpen: true, focusRequest: state.focusRequest + 1 })),
  closeInput: () => set({ inputOpen: false, notice: null }),
}));
