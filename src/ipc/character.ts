import type { UnlistenFn } from "@tauri-apps/api/event";
import type { ModelManifest } from "@/live2d/manifest";
import {
  type ActiveCharacter,
  type CharacterSummary,
  commands,
  events,
  type ImportKind,
  type ImportReview,
  type StagedImport,
} from "./bindings";
import { unwrap } from "./result";

export type { ActiveCharacter, CharacterSummary, ImportKind, ImportReview, StagedImport };

/** The installed characters, by name. */
export function listCharacters(): Promise<CharacterSummary[]> {
  return unwrap(commands.listCharacters());
}

/** The character the companion shows, or null if none is active. */
export function activeCharacter(): Promise<ActiveCharacter | null> {
  return unwrap(commands.activeCharacter());
}

/** Switches the companion to an installed character, or to none. */
export async function setActiveCharacter(id: string | null): Promise<void> {
  await unwrap(commands.setActiveCharacter(id));
}

/** Deletes an installed character and its saved preferences. */
export async function removeCharacter(id: string): Promise<void> {
  await unwrap(commands.removeCharacter(id));
}

/**
 * Lets the user pick a pack or model in a native dialog, then copies and validates it.
 * Resolves with null if the dialog was cancelled.
 */
export function stageImport(kind: ImportKind): Promise<StagedImport | null> {
  return unwrap(commands.stageCharacterImport(kind));
}

/**
 * Sends the manifest of a staged import's model for the core to check the mapping against.
 * The frontend's manifest type must stay assignable to the generated wire type (D42); this
 * call is where the compiler checks it.
 */
export function reviewImport(token: string, manifest: ModelManifest): Promise<ImportReview> {
  return unwrap(commands.reviewCharacterImport(token, manifest));
}

/** Installs a reviewed import and makes it active; `replace` replaces a same-id character. */
export async function commitImport(token: string, replace: boolean): Promise<void> {
  await unwrap(commands.commitCharacterImport(token, replace));
}

/** Discards a staged import. */
export async function cancelImport(token: string): Promise<void> {
  await unwrap(commands.cancelCharacterImport(token));
}

/** Subscribes to changes of the active character; null means none is active. */
export function onActiveCharacterChanged(
  handler: (character: ActiveCharacter | null) => void,
): Promise<UnlistenFn> {
  return events.activeCharacterChanged.listen(({ payload }) => handler(payload.character));
}

/** Subscribes to characters being installed or removed. */
export function onCharactersChanged(handler: () => void): Promise<UnlistenFn> {
  return events.charactersChanged.listen(() => handler());
}
