// The mapping's core slots as the settings window shows them.

import type { Target } from "@/ipc";

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

/** A motion group's name for display; model3.json allows an empty one. */
export function groupLabel(name: string): string {
  return name === "" ? "(unnamed)" : name;
}

export interface TargetLabel {
  kind: "Expression" | "Motion" | "Preset";
  name: string;
}

export function describeTarget(target: Target): TargetLabel {
  // The generated union types the other variants' keys as optional, so `in` cannot narrow.
  if (target.expression !== undefined) return { kind: "Expression", name: target.expression };
  if (target.motion !== undefined) return { kind: "Motion", name: groupLabel(target.motion) };
  return { kind: "Preset", name: target.preset };
}
