// The mapping's core slots as the settings window shows them.

import type { Mapping, Target } from "@/ipc";
import type { PresetName } from "@/live2d/presets";

export interface SlotInfo {
  id: string;
  label: string;
}

/** Mirrors `CORE_SLOTS` in `src-tauri/src/character/mapping.rs`, in the editor's order. */
export const BEHAVIOUR_SLOTS: readonly SlotInfo[] = [
  { id: "idle", label: "Idle" },
  { id: "talking", label: "Talking" },
  { id: "greet", label: "Greet" },
  { id: "thinking", label: "Thinking" },
  { id: "yawn", label: "Yawn" },
  { id: "sleepy", label: "Sleepy" },
  { id: "bored", label: "Bored" },
  { id: "tapped_head", label: "Tapped head" },
  { id: "tapped_body", label: "Tapped body" },
];

export const EMOTION_SLOTS: readonly SlotInfo[] = [
  { id: "neutral", label: "Neutral" },
  { id: "joy", label: "Joy" },
  { id: "sad", label: "Sad" },
  { id: "angry", label: "Angry" },
  { id: "surprised", label: "Surprised" },
  { id: "shy", label: "Shy" },
];

export const PRESET_LABELS: Record<PresetName, string> = {
  yawn: "Yawn",
  nod: "Nod",
  headTilt: "Head tilt",
  lookAway: "Look away",
  doze: "Doze",
};

/** What a character without a mapping starts editing from. */
export const EMPTY_MAPPING: Mapping = { slots: {}, custom: [], parameters: {} };

/** A motion group's name for display; model3.json allows an empty one. */
export function groupLabel(name: string): string {
  return name === "" ? "(unnamed)" : name;
}

export type TargetKind = "expression" | "motion" | "preset";

/** A target's kind and the name it points at. */
export function targetParts(target: Target): { kind: TargetKind; name: string } {
  // The generated union types the other variants' keys as optional, so `in` cannot narrow.
  if (target.expression !== undefined) return { kind: "expression", name: target.expression };
  if (target.motion !== undefined) return { kind: "motion", name: target.motion };
  return { kind: "preset", name: target.preset };
}

export function targetOf(kind: TargetKind, name: string): Target {
  switch (kind) {
    case "expression":
      return { expression: name };
    case "motion":
      return { motion: name };
    case "preset":
      return { preset: name };
  }
}

/** A target as one string, e.g. for a `<select>` value; the empty string is no target. */
export function targetKey(target: Target | undefined): string {
  if (!target) return "";
  const { kind, name } = targetParts(target);
  return `${kind}:${name}`;
}

export function parseTargetKey(key: string): Target | undefined {
  const colon = key.indexOf(":");
  const kind = key.slice(0, colon);
  if (kind !== "expression" && kind !== "motion" && kind !== "preset") return undefined;
  return targetOf(kind, key.slice(colon + 1));
}
