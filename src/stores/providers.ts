// Mirrors the provider profiles. The core owns them; this store only follows its events.

import { create } from "zustand";
import { listProviders, onProvidersChanged, type ProviderSummary } from "@/ipc";

interface ProvidersState {
  /** Undefined until the first read. */
  providers: ProviderSummary[] | undefined;
}

export const useProvidersStore = create<ProvidersState>()(() => ({
  providers: undefined,
}));

function warn(what: string) {
  return (error: unknown) => console.warn(`failed to ${what}`, error);
}

/** Keeps the store in step with the core. Returns a function that stops following it. */
export function syncProvidersStore(): () => void {
  // The event carries no payload, so every change is a fresh read; a sequence number keeps
  // a slow early read from overwriting a later one.
  let request = 0;
  const refresh = () => {
    const current = ++request;
    listProviders()
      .then((providers) => {
        if (current === request) useProvidersStore.setState({ providers });
      })
      .catch(warn("list the providers"));
  };
  const subscription = onProvidersChanged(refresh);
  refresh();
  return () => {
    subscription.then((stop) => stop()).catch(warn("unsubscribe from providers"));
  };
}
