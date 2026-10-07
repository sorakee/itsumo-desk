// The rules for custom mapping entries, mirrored from the core's `mapping.rs` so the editor
// can explain a problem before it saves. The core checks again.

import { BEHAVIOUR_SLOTS, EMOTION_SLOTS } from "@/windows/settings/mappingSlots";

/** Mirrors `MAX_CUSTOM_NAME_CHARS`: names become output tags, so they stay short. */
export const MAX_CUSTOM_NAME_LENGTH = 32;
/** Mirrors `MAX_DESCRIPTION_CHARS`. */
export const MAX_DESCRIPTION_LENGTH = 120;

const SLOT_IDS: ReadonlySet<string> = new Set(
  [...BEHAVIOUR_SLOTS, ...EMOTION_SLOTS].map((slot) => slot.id),
);

export type NameCheck = { name: string; error?: undefined } | { error: string };

/**
 * Mirrors `custom_name`: what the user typed as a name (trimmed, lower-case, runs of spaces
 * and hyphens as one `_`), or why it cannot be one. `taken` are the other entries' names.
 */
export function checkCustomName(raw: string, taken: readonly string[]): NameCheck {
  const name = raw
    .split(/[\s-]+/)
    .filter(Boolean)
    .join("_")
    .toLowerCase();
  if (name === "") return { error: "Give the entry a name." };
  if (name.length > MAX_CUSTOM_NAME_LENGTH) {
    return { error: `Names can be at most ${MAX_CUSTOM_NAME_LENGTH} characters long.` };
  }
  if (!/^[a-z0-9_]+$/.test(name)) return { error: "Use only letters a–z, digits and _." };
  if (SLOT_IDS.has(name)) return { error: `"${name}" is already a slot.` };
  if (taken.includes(name)) return { error: `Another entry is called "${name}".` };
  return { name };
}

/** Mirrors `description`: one line with single spaces, cut to the longest allowed. */
export function cleanDescription(raw: string): string {
  const line = raw
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .replace(/\p{Cc}/gu, "");
  return Array.from(line).slice(0, MAX_DESCRIPTION_LENGTH).join("");
}
