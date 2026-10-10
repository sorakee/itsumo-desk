import { useEffect } from "react";
import { Button } from "@/windows/settings/Button";
import { CharacterAvatar } from "@/windows/settings/CharacterAvatar";
import { NameInput } from "@/windows/settings/NameInput";
import type { ImportState } from "@/windows/settings/useCharacterImport";
import styles from "./ImportDialog.module.css";

interface ImportDialogProps {
  state: ImportState;
  onRename: (name: string) => void;
  onInstall: () => void;
  onCancel: () => void;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Shows an import from reading the model to the user's confirmation, or why it failed. */
export function ImportDialog({ state, onRename, onInstall, onCancel }: ImportDialogProps) {
  const open = state.step !== "idle" && state.step !== "picking";
  const busy = state.step === "installing";

  useEffect(() => {
    if (!open || busy) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onCancel]);

  if (!open) {
    return null;
  }

  return (
    <div className={styles.backdrop}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="import-title">
        {state.step === "failed" && (
          <>
            <h2 id="import-title" className={styles.title}>
              Import failed
            </h2>
            <p className={styles.error}>{state.message}</p>
            <div className={styles.buttons}>
              <Button tone="primary" onClick={onCancel} autoFocus>
                Close
              </Button>
            </div>
          </>
        )}

        {state.step === "reading" && (
          <>
            <h2 id="import-title" className={styles.title}>
              Reading {state.staged.character.name}…
            </h2>
            <p className={styles.muted}>Checking that the model loads.</p>
            <div className={styles.buttons}>
              <Button onClick={onCancel}>Cancel</Button>
            </div>
          </>
        )}

        {(state.step === "review" || state.step === "installing") && (
          <>
            <h2 id="import-title" className={styles.title}>
              {state.review.replaces === null ? "Import a character" : "Replace a character"}
            </h2>
            <div className={styles.heading}>
              <CharacterAvatar
                name={state.name.trim() || state.staged.character.name}
                iconUrl={state.staged.character.iconUrl}
                size="large"
              />
              <div className={styles.identity}>
                <NameInput
                  className={styles.name}
                  aria-label="Name"
                  value={state.name}
                  placeholder={state.staged.character.name}
                  disabled={busy}
                  onChange={(event) => onRename(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") onInstall();
                  }}
                />
                <p className={styles.muted}>
                  {state.staged.character.author || "Unknown author"} · id{" "}
                  <code>{state.staged.character.id}</code>
                </p>
              </div>
            </div>

            <p className={styles.summary}>
              {plural(state.manifest.expressions.length, "expression")},{" "}
              {plural(state.manifest.motionGroups.length, "motion group")},{" "}
              {plural(state.manifest.hitAreas.length, "hit area")},{" "}
              {plural(state.manifest.parameters.length, "parameter")}
            </p>

            {state.review.heavy.length > 0 && (
              <section className={styles.heavy} aria-labelledby="import-heavy">
                <h3 id="import-heavy" className={styles.heavyTitle}>
                  This model is heavy
                </h3>
                <ul>
                  {state.review.heavy.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <p className={styles.muted}>
                  It still works, but it costs more than Itsumo Desk aims for while it sits idle. A
                  lighter character brings the cost back down.
                </p>
              </section>
            )}

            <h3 className={styles.label}>Licence</h3>
            <p className={styles.license}>
              {state.staged.character.license || "The pack does not state a licence."}
            </p>

            {state.review.warnings.length > 0 && (
              <details className={styles.warnings}>
                <summary>{plural(state.review.warnings.length, "warning")}</summary>
                <ul>
                  {state.review.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </details>
            )}

            {state.review.replaces !== null && (
              <p className={styles.replace}>
                This replaces the installed “{state.review.replaces}”. Its saved framing is kept.
              </p>
            )}

            <div className={styles.buttons}>
              <Button onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
              <Button tone="primary" onClick={onInstall} disabled={busy} autoFocus>
                {state.review.replaces === null ? "Install" : "Replace"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
