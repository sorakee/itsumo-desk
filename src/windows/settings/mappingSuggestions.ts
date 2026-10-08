// Prefill (D45): the core suggests slots, parameter roles and base expressions from the
// model's names and its .vtube.json. The editor offers them; none applies by itself.

import type { Mapping } from "@/ipc";
import { targetKey } from "@/windows/settings/mappingSlots";

/**
 * The mapping with its empty slots and unset roles filled from `suggested`, or null if
 * nothing would change. A suggestion whose target another slot already plays is skipped.
 * Base expressions are never filled: they wait for the user to pick them.
 */
export function fillFromSuggestions(mapping: Mapping, suggested: Mapping): Mapping | null {
  const used = new Set(Object.values(mapping.slots).map(targetKey));
  const slots = { ...mapping.slots };
  const parameters = { ...mapping.parameters };
  let changed = false;
  for (const [slot, target] of Object.entries(suggested.slots)) {
    const key = targetKey(target);
    if (slots[slot] !== undefined || used.has(key)) continue;
    slots[slot] = target;
    used.add(key);
    changed = true;
  }
  for (const [role, id] of Object.entries(suggested.parameters)) {
    if (parameters[role] !== undefined) continue;
    parameters[role] = id;
    changed = true;
  }
  return changed ? { ...mapping, slots, parameters } : null;
}
