import { useState } from "react";
import type { CharacterSummary } from "@/ipc";
import { Button } from "@/windows/settings/Button";
import { CharacterAvatar } from "@/windows/settings/CharacterAvatar";
import styles from "./CharacterRow.module.css";

interface CharacterRowProps {
  character: CharacterSummary;
  active: boolean;
  disabled: boolean;
  onActivate: () => void;
  onRemove: () => void;
}

export function CharacterRow({
  character,
  active,
  disabled,
  onActivate,
  onRemove,
}: CharacterRowProps) {
  const [confirming, setConfirming] = useState(false);
  const meta = [character.author || "Unknown author", character.license]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className={styles.row}>
      <CharacterAvatar name={character.name} iconUrl={character.iconUrl} />
      <div className={styles.text}>
        <p className={styles.name}>
          {character.name}
          {active && <span className={styles.badge}>Active</span>}
        </p>
        <p className={styles.meta} title={meta}>
          {meta}
        </p>
      </div>
      <div className={styles.actions}>
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
