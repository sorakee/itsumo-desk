import { useState } from "react";
import type { CustomEntry, Mapping, Target } from "@/ipc";
import type { ModelManifest } from "@/live2d/manifest";
import { Button } from "@/windows/settings/Button";
import { CustomEntryRow } from "@/windows/settings/CustomEntryRow";
import { BEHAVIOUR_SLOTS, EMOTION_SLOTS, type SlotInfo } from "@/windows/settings/mappingSlots";
import { NewCustomEntry } from "@/windows/settings/NewCustomEntry";
import { Panel } from "@/windows/settings/Panel";
import { PreviewButton } from "@/windows/settings/PreviewButton";
import { TargetPicker } from "@/windows/settings/TargetPicker";
import type { PreviewActions } from "@/windows/settings/usePreviewActions";
import styles from "./MappingEditor.module.css";

const IDLE_SLOT = "idle";

/** What an unmapped idle slot plays: the "Idle" group, as the companion falls back to. */
function idleFallback(manifest: ModelManifest): string {
  const group = manifest.motionGroups.find((g) => g.name.toLowerCase() === "idle");
  return group ? `Not mapped (plays ${group.name})` : "Not mapped";
}

interface MappingEditorProps {
  mapping: Mapping;
  /** Whether the mapping is the user's edits rather than the pack's own. */
  customized: boolean;
  warnings: string[];
  /** Why the last change was not saved, if it was not. */
  saveError: string | null;
  manifest: ModelManifest;
  actions: PreviewActions;
  onChange: (mapping: Mapping) => void;
  onReset: () => void;
}

/** The character's mapping, saved as it is edited. */
export function MappingEditor({
  mapping,
  customized,
  warnings,
  saveError,
  manifest,
  actions,
  onChange,
  onReset,
}: MappingEditorProps) {
  const [confirmingReset, setConfirmingReset] = useState(false);
  const parameters = Object.entries(mapping.parameters);
  const names = mapping.custom.map((entry) => entry.name);

  function setSlot(slot: string, target: Target | undefined) {
    const others = Object.fromEntries(Object.entries(mapping.slots).filter(([s]) => s !== slot));
    onChange({ ...mapping, slots: target ? { ...others, [slot]: target } : others });
  }

  function setCustom(custom: CustomEntry[]) {
    onChange({ ...mapping, custom });
  }

  function slotList(slots: readonly SlotInfo[]) {
    return (
      <ul className={styles.slots}>
        {slots.map(({ id, label }) => (
          <li key={id} className={styles.slot}>
            <span className={styles.slotName}>{label}</span>
            <TargetPicker
              target={mapping.slots[id]}
              manifest={manifest}
              motionsOnly={id === IDLE_SLOT}
              emptyLabel={id === IDLE_SLOT ? idleFallback(manifest) : undefined}
              aria-label={label}
              onChange={(target) => setSlot(id, target)}
            />
            <PreviewButton target={mapping.slots[id]} actions={actions} label={label} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Panel
      title="Mapping"
      hint="What the character plays for the app's slots and its own entries. Changes save as you make them."
    >
      {saveError && (
        <p className={styles.saveError} role="alert">
          {saveError}
        </p>
      )}
      <h3 className={styles.heading}>Behaviour</h3>
      {slotList(BEHAVIOUR_SLOTS)}
      <h3 className={styles.heading}>Emotions</h3>
      {slotList(EMOTION_SLOTS)}

      <h3 className={styles.heading}>Custom</h3>
      <p className={styles.note}>
        The character's own expressions and motions, by a name and a hint on when to use them.
      </p>
      {mapping.custom.length > 0 && (
        <ul className={styles.entries}>
          {mapping.custom.map((entry, index) => (
            <CustomEntryRow
              // Rows follow position; each one resyncs its fields when its entry changes.
              // biome-ignore lint/suspicious/noArrayIndexKey: a key by name would remount the row on rename
              key={index}
              entry={entry}
              taken={names.filter((_, i) => i !== index)}
              manifest={manifest}
              actions={actions}
              onChange={(changed) =>
                setCustom(mapping.custom.map((e, i) => (i === index ? changed : e)))
              }
              onRemove={() => setCustom(mapping.custom.filter((_, i) => i !== index))}
            />
          ))}
        </ul>
      )}
      <NewCustomEntry
        taken={names}
        manifest={manifest}
        onAdd={(entry) => setCustom([...mapping.custom, entry])}
      />

      {parameters.length > 0 && (
        <>
          <h3 className={styles.heading}>Parameters</h3>
          <dl className={styles.parameters}>
            {parameters.map(([role, id]) => (
              <div key={role} className={styles.parameter}>
                <dt className={styles.slotName}>{role}</dt>
                <dd className={styles.parameterId}>{id}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {warnings.length > 0 && (
        <ul className={styles.warnings}>
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {customized && (
        <div className={styles.reset}>
          {confirmingReset ? (
            <>
              <span className={styles.resetText}>
                Discard your changes and go back to the pack's own mapping?
              </span>
              <Button
                tone="danger"
                onClick={() => {
                  setConfirmingReset(false);
                  onReset();
                }}
              >
                Reset
              </Button>
              <Button onClick={() => setConfirmingReset(false)}>Cancel</Button>
            </>
          ) : (
            <>
              <span className={styles.resetText}>This mapping has your changes.</span>
              <Button onClick={() => setConfirmingReset(true)}>Reset…</Button>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}
