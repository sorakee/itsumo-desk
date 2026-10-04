// Mirrors the installed characters and the active one. The core owns both; this store only
// follows its events.

import { create } from "zustand";
import {
  type ActiveCharacter,
  activeCharacter,
  type CharacterSummary,
  listCharacters,
  onActiveCharacterChanged,
  onCharactersChanged,
} from "@/ipc";

interface CharactersState {
  /** Undefined until the first read. */
  characters: CharacterSummary[] | undefined;
  /** Null when no character is active; undefined until the first read. */
  active: ActiveCharacter | null | undefined;
}

export const useCharactersStore = create<CharactersState>()(() => ({
  characters: undefined,
  active: undefined,
}));

function warn(what: string) {
  return (error: unknown) => console.warn(`failed to ${what}`, error);
}

/** Keeps the store in step with the core. Returns a function that stops following it. */
export function syncCharactersStore(): () => void {
  // An event that arrives before the initial read is newer than what the read returns.
  let heardActive = false;
  // The list event carries no payload, so every change is a fresh read; a sequence number
  // keeps a slow early read from overwriting a later one.
  let listRequest = 0;
  const refreshList = () => {
    const request = ++listRequest;
    listCharacters()
      .then((characters) => {
        if (request === listRequest) useCharactersStore.setState({ characters });
      })
      .catch(warn("list the characters"));
  };

  const subscriptions = [
    onActiveCharacterChanged((active) => {
      heardActive = true;
      useCharactersStore.setState({ active });
    }),
    onCharactersChanged(refreshList),
  ];
  refreshList();
  activeCharacter()
    .then((active) => {
      if (!heardActive) useCharactersStore.setState({ active });
    })
    .catch((error: unknown) => {
      warn("read the active character")(error);
      if (!heardActive) useCharactersStore.setState({ active: null });
    });

  return () => {
    for (const subscription of subscriptions) {
      subscription.then((stop) => stop()).catch(warn("unsubscribe from characters"));
    }
  };
}
