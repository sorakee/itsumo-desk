import { type KeyboardEvent, useEffect, useId, useState } from "react";
import type { CustomEntry } from "@/ipc";
import type { ModelManifest } from "@/live2d/manifest";
import { Icon } from "@/shared/Icon";
import {
  checkCustomName,
  cleanDescription,
  MAX_CUSTOM_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
} from "@/windows/settings/mappingRules";
import { PreviewButton } from "@/windows/settings/PreviewButton";
import { TargetPicker } from "@/windows/settings/TargetPicker";
import type { PreviewActions } from "@/windows/settings/usePreviewActions";
import styles from "./CustomEntryRow.module.css";

interface CustomEntryRowProps {
  entry: CustomEntry;
  /** The other entries' names. */
  taken: readonly string[];
  manifest: ModelManifest;
  actions: PreviewActions;
  onChange: (entry: CustomEntry) => void;
  onRemove: () => void;
}

/**
 * One custom entry, edited in place. The target saves when picked; the text fields save on
 * Enter or when they lose focus, and Escape undoes what was typed.
 */
export function CustomEntryRow({
  entry,
  taken,
  manifest,
  actions,
  onChange,
  onRemove,
}: CustomEntryRowProps) {
  const [name, setName] = useState(entry.name);
  const [description, setDescription] = useState(entry.description);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  // Follows the saved entry, e.g. when a save fails or a removal shifts the rows.
  useEffect(() => {
    setName(entry.name);
    setError(null);
  }, [entry.name]);
  useEffect(() => {
    setDescription(entry.description);
  }, [entry.description]);

  function commitName() {
    const checked = checkCustomName(name, taken);
    if (checked.error !== undefined) {
      setError(checked.error);
      return;
    }
    setError(null);
    setName(checked.name);
    if (checked.name !== entry.name) onChange({ ...entry, name: checked.name });
  }

  function commitDescription() {
    const cleaned = cleanDescription(description);
    setDescription(cleaned);
    if (cleaned !== entry.description) onChange({ ...entry, description: cleaned });
  }

  function onNameKey(event: KeyboardEvent) {
    if (event.key === "Enter") {
      commitName();
    } else if (event.key === "Escape") {
      setName(entry.name);
      setError(null);
    }
  }

  function onDescriptionKey(event: KeyboardEvent) {
    if (event.key === "Enter") {
      commitDescription();
    } else if (event.key === "Escape") {
      setDescription(entry.description);
    }
  }

  return (
    <li className={styles.row}>
      <input
        type="text"
        className={styles.input}
        value={name}
        maxLength={MAX_CUSTOM_NAME_LENGTH}
        spellCheck={false}
        autoComplete="off"
        aria-label="Entry name"
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : errorId}
        onChange={(event) => setName(event.target.value)}
        onBlur={commitName}
        onKeyDown={onNameKey}
      />
      <TargetPicker
        target={entry.target}
        manifest={manifest}
        required
        aria-label={`What ${entry.name} plays`}
        onChange={(target) => target && onChange({ ...entry, target })}
      />
      <PreviewButton target={entry.target} actions={actions} label={entry.name} />
      <button
        type="button"
        className={styles.remove}
        aria-label={`Remove ${entry.name}`}
        title="Remove"
        onClick={onRemove}
      >
        <Icon name="close" />
      </button>
      <input
        type="text"
        className={`${styles.input} ${styles.description}`}
        value={description}
        maxLength={MAX_DESCRIPTION_LENGTH}
        placeholder="When to use it, e.g. half-lidded grin, use when teasing"
        aria-label={`Description of ${entry.name}`}
        onChange={(event) => setDescription(event.target.value)}
        onBlur={commitDescription}
        onKeyDown={onDescriptionKey}
      />
      {error !== null && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </li>
  );
}
