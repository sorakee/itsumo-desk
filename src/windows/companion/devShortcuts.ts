// Dev builds only: plays parameter presets from the keyboard until something triggers them
// for real (the autonomy scheduler, M3). Click the model to focus the window first.

import { PRESET_NAMES } from "@/live2d/presets";
import type { Stage } from "@/live2d/stage";

/** Keys 1 to 5 play the presets in `PRESET_NAMES` order; 0 stops the playing one. */
export function startDevShortcuts(stage: Stage): () => void {
  function onKeyDown(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === "0") {
      stage.stopPreset();
      return;
    }
    const name = PRESET_NAMES[Number(event.key) - 1];
    if (name) {
      stage.playPreset(name);
    }
  }

  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
