// Which installed characters the companion menu's character ring shows (D42).

import type { CharacterSummary } from "@/ipc";

/** Buttons in the character ring, "Manage…" included: eight fit the smallest window (D41). */
export const CHARACTER_RING_SIZE = 8;

export interface CharacterRing {
  shown: CharacterSummary[];
  /** True when some installed characters did not fit. */
  overflow: boolean;
}

/**
 * The characters for `slots` buttons, in the core's order (by name) so each keeps its place.
 * When they do not all fit, the active one takes the last slot if it would be left out.
 */
export function characterRing(
  characters: readonly CharacterSummary[],
  activeId: string | null,
  slots: number,
): CharacterRing {
  if (characters.length <= slots) return { shown: [...characters], overflow: false };
  const shown = characters.slice(0, slots);
  const active = characters.find((character) => character.id === activeId);
  if (active && !shown.includes(active)) shown[slots - 1] = active;
  return { shown, overflow: true };
}
