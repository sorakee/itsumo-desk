// Mirrors companion window state owned by the core. The core is the source of truth; this
// store only follows its events.

import { create } from "zustand";
import { alwaysOnTop, onAlwaysOnTopChanged } from "@/ipc";

interface CompanionState {
  alwaysOnTop: boolean;
}

export const useCompanionStore = create<CompanionState>()(() => ({ alwaysOnTop: false }));

/** Keeps the store in step with the core. Returns a function that stops following it. */
export function syncCompanionStore(): () => void {
  // An event that arrives before the initial read is newer than what the read returns.
  let heard = false;
  const subscription = onAlwaysOnTopChanged((enabled) => {
    heard = true;
    useCompanionStore.setState({ alwaysOnTop: enabled });
  });
  alwaysOnTop()
    .then((enabled) => {
      if (!heard) useCompanionStore.setState({ alwaysOnTop: enabled });
    })
    .catch((error: unknown) => console.warn("failed to read always-on-top", error));
  return () => {
    subscription
      .then((stop) => stop())
      .catch((error: unknown) => console.warn("failed to unsubscribe from always-on-top", error));
  };
}
