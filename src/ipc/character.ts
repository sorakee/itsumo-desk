import type { UnlistenFn } from "@tauri-apps/api/event";
import type { ModelManifest } from "@/live2d/manifest";
import {
  type ActiveCharacter,
  type CharacterMapping,
  type CharacterSummary,
  type CustomEntry,
  commands,
  events,
  type ImportKind,
  type ImportReview,
  type Mapping,
  type StagedImport,
  type Target,
} from "./bindings";
import { unwrap } from "./result";

export type {
  ActiveCharacter,
  CharacterMapping,
  CharacterSummary,
  CustomEntry,
  ImportKind,
  ImportReview,
  Mapping,
  StagedImport,
  Target,
};

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

/** Gives an installed character a display name; null or a blank name restores the pack's. */
export async function renameCharacter(id: string, name: string | null): Promise<void> {
  await unwrap(commands.renameCharacter(id, name));
}

/** Marks an installed character as a favourite, or unmarks it. */
export async function setCharacterFavorite(id: string, favorite: boolean): Promise<void> {
  await unwrap(commands.setCharacterFavorite(id, favorite));
}

/** An installed character's model and mapping, for the mapping editor. */
export function characterMapping(id: string): Promise<CharacterMapping> {
  return unwrap(commands.characterMapping(id));
}

/** Saves the user's edits to a character's mapping and returns it as the editor shows it. */
export function saveCharacterMapping(id: string, mapping: Mapping): Promise<CharacterMapping> {
  return unwrap(commands.saveCharacterMapping(id, mapping));
}

/** Drops the user's edits to a character's mapping, going back to the pack's own. */
export function resetCharacterMapping(id: string): Promise<CharacterMapping> {
  return unwrap(commands.resetCharacterMapping(id));
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

/**
 * Installs a reviewed import under `name` (blank keeps the pack's) and makes it active;
 * `replace` replaces a same-id character.
 */
export async function commitImport(token: string, replace: boolean, name: string): Promise<void> {
  await unwrap(commands.commitCharacterImport(token, replace, name));
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

/** Subscribes to saved or reset mappings, with the mapping now in effect. */
export function onMappingChanged(
  handler: (id: string, mapping: Mapping | null) => void,
): Promise<UnlistenFn> {
  return events.mappingChanged.listen(({ payload }) => handler(payload.id, payload.mapping));
}

/** Subscribes to characters being installed or removed. */
export function onCharactersChanged(handler: () => void): Promise<UnlistenFn> {
  return events.charactersChanged.listen(() => handler());
}
