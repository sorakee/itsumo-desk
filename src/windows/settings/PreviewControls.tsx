import type { ModelManifest } from "@/live2d/manifest";
import { PRESET_NAMES } from "@/live2d/presets";
import { Icon } from "@/shared/Icon";
import { groupLabel, PRESET_LABELS } from "@/windows/settings/mappingSlots";
import { Panel } from "@/windows/settings/Panel";
import { LOOPING_PRESET, type PreviewActions } from "@/windows/settings/usePreviewActions";
import styles from "./PreviewControls.module.css";

function fileStem(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(/\.motion3\.json$/i, "");
}

interface PreviewControlsProps {
  manifest: ModelManifest;
  actions: PreviewActions;
}

/** Buttons that play the model's expressions, motions and the built-in presets. */
export function PreviewControls({ manifest, actions }: PreviewControlsProps) {
  const { expression, looping, toggleExpression, playMotion, playPreset } = actions;

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
                      onClick={() => playMotion(group.name, index)}
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
