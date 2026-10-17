import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { clearProviderKey, type ProviderSummary, setProviderKey } from "@/ipc";
import { errorMessage } from "@/shared/errorMessage";
import { Button } from "@/windows/settings/Button";
import styles from "./ProviderKeyField.module.css";

interface ProviderKeyFieldProps {
  provider: ProviderSummary;
  /** False for local servers, which take no key. */
  needsKey: boolean;
}

/** Write-only: a key goes to the core once and is never shown or sent back. */
export function ProviderKeyField({ provider, needsKey }: ProviderKeyFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Replacing swaps the field in for the button the user just pressed, so focus follows.
  useEffect(() => {
    if (replacing) input.current?.focus();
  }, [replacing]);

  function run(action: () => Promise<void>, after: () => void) {
    setBusy(true);
    setError(null);
    action()
      .then(after, (reason: unknown) => setError(errorMessage(reason)))
      .finally(() => setBusy(false));
  }

  function save() {
    const key = input.current?.value.trim() ?? "";
    if (key === "") return;
    run(
      () => setProviderKey(provider.id, key),
      () => {
        if (input.current) input.current.value = "";
        setReplacing(false);
      },
    );
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      save();
    } else if (event.key === "Escape" && provider.keySet) {
      setReplacing(false);
    }
  }

  if (provider.keySet && !replacing) {
    return (
      <div className={styles.row}>
        {confirming ? (
          <>
            <span className={styles.confirm}>Delete the saved key? It cannot be shown again.</span>
            <Button
              tone="danger"
              disabled={busy}
              onClick={() =>
                run(
                  () => clearProviderKey(provider.id),
                  () => setConfirming(false),
                )
              }
            >
              Remove
            </Button>
            <Button onClick={() => setConfirming(false)} disabled={busy}>
              Keep
            </Button>
          </>
        ) : (
          <>
            <span className={styles.saved}>Saved in Credential Manager</span>
            <Button onClick={() => setReplacing(true)}>Replace</Button>
            <Button onClick={() => setConfirming(true)}>Remove</Button>
          </>
        )}
        {error && <p className={styles.error}>{error}</p>}
      </div>
    );
  }

  return (
    <div className={styles.row}>
      <input
        ref={input}
        type="password"
        className={styles.input}
        aria-label="API key"
        placeholder={needsKey ? "Paste your API key" : "Not needed for a local server"}
        autoComplete="off"
        spellCheck={false}
        disabled={busy}
        onKeyDown={onKeyDown}
      />
      <Button onClick={save} disabled={busy}>
        Save key
      </Button>
      {replacing && (
        <Button onClick={() => setReplacing(false)} disabled={busy}>
          Cancel
        </Button>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
