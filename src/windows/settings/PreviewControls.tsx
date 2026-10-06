import { useState } from "react";
import type { ModelManifest } from "@/live2d/manifest";
import { PRESET_NAMES, type PresetName } from "@/live2d/presets";
import type { Stage } from "@/live2d/stage";
import { Icon } from "@/shared/Icon";
import { groupLabel } from "@/windows/settings/mappingSlots";
import { Panel } from "@/windows/settings/Panel";
import styles from "./PreviewControls.module.css";

const PRESET_LABELS: Record<PresetName, string> = {
  yawn: "Yawn",
  nod: "Nod",
  headTilt: "Head tilt",
  lookAway: "Look away",
  doze: "Doze",
};

// Plays until stopped, so its button toggles.
const LOOPING_PRESET: PresetName = "doze";

function fileStem(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(/\.motion3\.json$/i, "");
}

interface PreviewControlsProps {
  stage: Stage;
  manifest: ModelManifest;
}

/** Buttons that play the model's expressions, motions and the built-in presets. */
export function PreviewControls({ stage, manifest }: PreviewControlsProps) {
  const [expression, setExpression] = useState<string | null>(null);
  const [looping, setLooping] = useState(false);

  function toggleExpression(name: string) {
    const next = expression === name ? null : name;
    stage.setExpression(next);
    setExpression(next);
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

  return (
    <>
      <Panel
        title="Expressions"
        count={manifest.expressions.length}
        hint="Click to show one on the preview; click again to clear it."
      >
        {manifest.expressions.length === 0 ? (
          <p className={styles.empty}>This model has no expressions.</p>
        ) : (
          <div className={styles.chips}>
            {manifest.expressions.map((name) => (
              <button
                key={name}
                type="button"
                className={styles.chip}
                aria-pressed={expression === name}
                onClick={() => toggleExpression(name)}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="Motions"
        count={manifest.motionGroups.length}
        hint="Groups of motions; a slot plays one from its group."
      >
        {manifest.motionGroups.length === 0 ? (
          <p className={styles.empty}>This model has no motions.</p>
        ) : (
          <ul className={styles.groups}>
            {manifest.motionGroups.map((group) => (
              <li key={group.name} className={styles.group}>
                <span className={group.name === "" ? styles.unnamed : styles.groupName}>
                  {groupLabel(group.name)}
                </span>
                <span className={styles.chips}>
                  {group.motions.map((file, index) => (
                    <button
                      key={file}
                      type="button"
                      className={styles.chip}
                      title={file}
                      aria-label={`Play ${fileStem(file)}`}
                      onClick={() => stage.playMotion(group.name, index)}
                    >
                      <Icon name="play" className={styles.playIcon} />
                      {group.motions.length === 1 ? "Play" : index + 1}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Presets"
        count={PRESET_NAMES.length}
        hint="Built into Itsumo Desk; they move the model's standard parameters."
      >
        <div className={styles.chips}>
          {PRESET_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              className={styles.chip}
              aria-pressed={name === LOOPING_PRESET ? looping : undefined}
              onClick={() => playPreset(name)}
            >
              {PRESET_LABELS[name]}
            </button>
          ))}
        </div>
      </Panel>
    </>
  );
}
