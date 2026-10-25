import { useCallback, useEffect, useState } from "react";
import { chatHotkey, type HotkeyStatus, setChatHotkey } from "@/ipc";
import { errorMessage } from "@/shared/errorMessage";
import { Button } from "@/windows/settings/Button";
import styles from "./HotkeyCard.module.css";

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "AltGraph", "OS"]);

/** A key press as the core parses shortcuts, e.g. `Ctrl+Shift+KeyK`; null for a lone modifier. */
function shortcutOf(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const parts = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Super");
  parts.push(event.code);
  return parts.join("+");
}

/** The chat hotkey (D57): shows it, records a new one, and says when Windows refused it. */
export function HotkeyCard() {
  const [status, setStatus] = useState<HotkeyStatus | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    chatHotkey()
      .then(setStatus)
      .catch((reason: unknown) => setError(errorMessage(reason)));
  }, []);

  const apply = useCallback((shortcut: string | null) => {
    setError(null);
    setChatHotkey(shortcut)
      .then(setStatus)
      .catch((reason: unknown) => setError(errorMessage(reason)));
  }, []);

  useEffect(() => {
    if (!recording) return;
    function onKeyDown(event: KeyboardEvent) {
      event.preventDefault();
      event.stopPropagation();
      const plain = !(event.ctrlKey || event.altKey || event.shiftKey || event.metaKey);
      if (event.key === "Escape" && plain) {
        setRecording(false);
        return;
      }
      const shortcut = shortcutOf(event);
      if (shortcut === null) return;
      setRecording(false);
      apply(shortcut);
    }
    // Clicking elsewhere ends recording, as Escape does.
    function onPointerDown() {
      setRecording(false);
    }
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onPointerDown);
    };
  }, [recording, apply]);

  const refused = status?.error ?? null;

  return (
    <section className={styles.card} aria-labelledby="hotkey-title">
      <h3 id="hotkey-title" className={styles.title}>
        Chat hotkey
      </h3>
      <p className={styles.hint}>
        Opens the chat from anywhere, and shows the companion if it is hidden.
      </p>
      <div className={styles.row}>
        <output className={styles.keys} aria-live="polite" data-recording={recording}>
          {recording
            ? "Press the new shortcut…"
            : status?.shortcut.split("+").map((key) => (
                <kbd key={key} className={styles.key}>
                  {key}
                </kbd>
              ))}
        </output>
        <Button tone="primary" onClick={() => setRecording(true)} disabled={recording}>
          Change
        </Button>
        <Button onClick={() => apply(null)} disabled={recording || (status?.isDefault ?? true)}>
          Reset
        </Button>
      </div>
      {refused && <p className={styles.error}>{refused}</p>}
      {error && <p className={styles.error}>{error}</p>}
      <p className={styles.note}>
        Use Ctrl, Alt or Win in it. On keyboard layouts with an AltGr key, Ctrl+Alt is AltGr, so a
        Ctrl+Alt shortcut takes over that AltGr character while the app runs.
      </p>
    </section>
  );
}
