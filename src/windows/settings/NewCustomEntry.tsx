import { type KeyboardEvent, useId, useState } from "react";
import type { CustomEntry, Target } from "@/ipc";
import type { ModelManifest } from "@/live2d/manifest";
import { Button } from "@/windows/settings/Button";
import {
  checkCustomName,
  cleanDescription,
  MAX_CUSTOM_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
} from "@/windows/settings/mappingRules";
import { TargetPicker } from "@/windows/settings/TargetPicker";
import styles from "./NewCustomEntry.module.css";

interface NewCustomEntryProps {
  /** The existing entries' names. */
  taken: readonly string[];
  manifest: ModelManifest;
  onAdd: (entry: CustomEntry) => void;
}

/** Fields for a new custom entry; it joins the mapping once it has a name and a target. */
export function NewCustomEntry({ taken, manifest, onAdd }: NewCustomEntryProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [target, setTarget] = useState<Target | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  function add() {
    const checked = checkCustomName(name, taken);
    if (checked.error !== undefined) {
      setError(checked.error);
      return;
    }
    if (!target) {
      setError("Choose what the entry plays.");
      return;
    }
    onAdd({ name: checked.name, description: cleanDescription(description), target });
    setName("");
    setDescription("");
    setTarget(undefined);
    setError(null);
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === "Enter") add();
  }

  return (
    <div className={styles.row}>
      <input
        type="text"
        className={styles.input}
        value={name}
        maxLength={MAX_CUSTOM_NAME_LENGTH}
        spellCheck={false}
        autoComplete="off"
        placeholder="New entry, e.g. smug"
        aria-label="New entry name"
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : errorId}
        onChange={(event) => {
          setName(event.target.value);
          setError(null);
        }}
        onKeyDown={onKey}
      />
      <TargetPicker
        target={target}
        manifest={manifest}
        required
        aria-label="What the new entry plays"
        onChange={setTarget}
      />
      <Button disabled={name.trim() === "" || !target} onClick={add}>
        Add
      </Button>
      <input
        type="text"
        className={`${styles.input} ${styles.description}`}
        value={description}
        maxLength={MAX_DESCRIPTION_LENGTH}
        placeholder="When to use it (optional)"
        aria-label="New entry description"
        onChange={(event) => setDescription(event.target.value)}
        onKeyDown={onKey}
      />
      {error !== null && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
