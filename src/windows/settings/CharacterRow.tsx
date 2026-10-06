import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { CharacterSummary } from "@/ipc";
import { Icon } from "@/shared/Icon";
import { Button } from "@/windows/settings/Button";
import { CharacterAvatar } from "@/windows/settings/CharacterAvatar";
import { NameInput } from "@/windows/settings/NameInput";
import styles from "./CharacterRow.module.css";

interface CharacterRowProps {
  character: CharacterSummary;
  active: boolean;
  disabled: boolean;
  onActivate: () => void;
  onEditMapping: () => void;
  onRemove: () => void;
  /** Null goes back to the pack's name. Resolves to whether the rename was saved. */
  onRename: (name: string | null) => Promise<boolean>;
  onToggleFavorite: () => void;
}

export function CharacterRow({
  character,
  active,
  disabled,
  onActivate,
  onEditMapping,
  onRemove,
  onRename,
  onToggleFavorite,
}: CharacterRowProps) {
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  // Enter and Escape unmount the field, which then blurs; only the first of them counts.
  const finished = useRef(false);
  const renameButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  // A saved name shows until the core's list catches up, instead of the old one flashing
  // back. It applies only while the listed name is still the one it replaced.
  const [pending, setPending] = useState<{ name: string; replaces: string } | null>(null);
  const name = pending?.replaces === character.name ? pending.name : character.name;
  const renamed = name !== character.packName;
  const meta = [
    renamed && `Pack name: ${character.packName}`,
    character.author || "Unknown author",
    character.license,
  ]
    .filter(Boolean)
    .join(" · ");

  useEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    renameButton.current?.focus();
  }, [editing]);

  function startEditing() {
    finished.current = false;
    setEditing(true);
  }

  /** Ends editing, saving `value` unless it is null (cancelled) or unchanged. */
  function finish(value: string | null) {
    if (finished.current) return;
    finished.current = true;
    setEditing(false);
    if (value === null) return;
    const typed = value.trim();
    if (typed === name) return;
    const saved = { name: typed || character.packName, replaces: character.name };
    setPending(saved);
    onRename(typed || null).then((ok) => {
      if (!ok) setPending((current) => (current === saved ? null : current));
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    refocus.current = true;
    finish(event.key === "Enter" ? event.currentTarget.value : null);
  }

  return (
    <li className={styles.row}>
      <CharacterAvatar name={name} iconUrl={character.iconUrl} />
      <div className={styles.text}>
        {editing ? (
          <NameInput
            className={styles.nameInput}
            aria-label="Display name"
            defaultValue={name}
            placeholder={character.packName}
            // The field replaces the button the user just pressed, so focus has to follow.
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={onKeyDown}
            onBlur={(event) => finish(event.currentTarget.value)}
          />
        ) : (
          <p className={styles.name}>
            <span className={styles.nameText}>{name}</span>
            <button
              ref={renameButton}
              type="button"
              className={`${styles.iconButton} ${styles.rename}`}
              aria-label={`Rename ${name}`}
              title="Rename"
              disabled={disabled}
              onClick={startEditing}
            >
              <Icon name="pencil" />
            </button>
            {active && <span className={styles.badge}>Active</span>}
          </p>
        )}
        <p className={styles.meta} title={meta}>
          {meta}
        </p>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.iconButton} ${character.favorite ? styles.favorite : ""}`}
          aria-label="Favourite"
          aria-pressed={character.favorite}
          title={character.favorite ? "Remove from favourites" : "Add to favourites"}
          disabled={disabled}
          onClick={onToggleFavorite}
        >
          <Icon name="star" />
        </button>
        {confirming ? (
          <>
            <span className={styles.confirm}>Remove it and its settings?</span>
            <Button
              tone="danger"
              onClick={() => {
                setConfirming(false);
                onRemove();
              }}
            >
              Remove
            </Button>
            <Button onClick={() => setConfirming(false)}>Keep</Button>
          </>
        ) : (
          <>
            <Button onClick={onEditMapping} disabled={disabled}>
              Mapping
            </Button>
            {!active && (
              <Button onClick={onActivate} disabled={disabled}>
                Use
              </Button>
            )}
            <Button onClick={() => setConfirming(true)} disabled={disabled}>
              Remove
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
