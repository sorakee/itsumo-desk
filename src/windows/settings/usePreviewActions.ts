// What the mapping view plays on its preview stage. Shared by the preview buttons and the
// editor's, so a toggled expression or a running doze shows as such in both.

import { useState } from "react";
import type { Target } from "@/ipc";
import type { ModelManifest } from "@/live2d/manifest";
import { PRESET_NAMES, type PresetName } from "@/live2d/presets";
import type { Stage } from "@/live2d/stage";
import { targetParts } from "@/windows/settings/mappingSlots";

// Plays until stopped, so its button toggles.
export const LOOPING_PRESET: PresetName = "doze";

function isPresetName(name: string): name is PresetName {
  return (PRESET_NAMES as readonly string[]).includes(name);
}

export interface PreviewActions {
  /** The expression shown, if any. */
  expression: string | null;
  /** Whether the looping preset plays. */
  looping: boolean;
  toggleExpression(name: string): void;
  playMotion(group: string, index: number): void;
  /** Plays a preset; the looping one stops instead if it is playing. */
  playPreset(name: PresetName): void;
  /** Plays what a slot or custom entry points at; a motion group plays a random motion. */
  playTarget(target: Target): void;
  /**
   * For targets that toggle (expressions, the looping preset), whether they are on;
   * undefined for those that play once.
   */
  pressed(target: Target): boolean | undefined;
}

export function usePreviewActions(stage: Stage, manifest: ModelManifest): PreviewActions {
  const [expression, setExpression] = useState<string | null>(null);
  const [looping, setLooping] = useState(false);

  function toggleExpression(name: string) {
    const next = expression === name ? null : name;
    stage.setExpression(next);
    setExpression(next);
  }

  function playMotion(group: string, index: number) {
    stage.playMotion(group, index);
  }

  function playPreset(name: PresetName) {
    if (name === LOOPING_PRESET && looping) {
      stage.stopPreset();
      setLooping(false);
      return;
    }
    stage.playPreset(name);
    setLooping(name === LOOPING_PRESET);
  }

  function playTarget(target: Target) {
    const { kind, name } = targetParts(target);
    if (kind === "expression") {
      toggleExpression(name);
    } else if (kind === "motion") {
      const count = manifest.motionGroups.find((g) => g.name === name)?.motions.length ?? 0;
      if (count > 0) playMotion(name, Math.floor(Math.random() * count));
    } else if (isPresetName(name)) {
      playPreset(name);
    }
  }

  function pressed(target: Target) {
    const { kind, name } = targetParts(target);
    if (kind === "expression") return expression === name;
    if (kind === "preset" && name === LOOPING_PRESET) return looping;
    return undefined;
  }

  return { expression, looping, toggleExpression, playMotion, playPreset, playTarget, pressed };
}
