import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { openSettings } from "@/ipc";
import { useChatStore } from "@/stores/chat";
import { lastSentMessage, sendMessage } from "@/windows/companion/chat";
import { HIT_REGION_ATTRIBUTE } from "@/windows/companion/interaction";
import styles from "./ChatInput.module.css";

/** Mirrors `MAX_MESSAGE_CHARS` in `agent/mod.rs`. */
const MAX_MESSAGE_CHARS = 2000;
/** An empty input closes after this long with nothing happening. */
const IDLE_CLOSE_MS = 30_000;
/** Measured: a window drag blurs the page for about 3 ms. */
const BLUR_GRACE_MS = 150;

// Only the pill and the notice catch clicks; beside them they pass through.
const hitRegion = { [HIT_REGION_ATTRIBUTE]: true };

/**
 * The chat input (D57): a pill at the bottom of the companion. Enter sends, Escape closes,
 * Up recalls the last message. It stays open after sending, and closes on its own when it
 * is empty and the user switches to another app or leaves it idle.
 */
export function ChatInput() {
  const status = useChatStore((state) => state.status);
  const focusRequest = useChatStore((state) => state.focusRequest);
  const notice = useChatStore((state) => state.notice);
  const busy = useChatStore((state) => state.waiting || state.subtitle !== null);
  const closeInput = useChatStore((state) => state.closeInput);
  const [draft, setDraft] = useState("");
  const dockRef = useRef<HTMLFieldSetElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const notReady = status?.kind === "notReady" ? status.message : null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: each request moves focus here again.
  useEffect(() => {
    (inputRef.current ?? settingsRef.current)?.focus();
  }, [focusRequest, notReady]);

  // Leaving for another app with nothing typed closes it. Presses elsewhere in the window
  // keep the focus here. Dragging the companion hands focus to the native window and back
  // within a few milliseconds, so a blur only counts once the page is still unfocused a
  // moment later, and returning focus goes back to the input.
  const empty = draft.trim() === "";
  useEffect(() => {
    let blurTimer: ReturnType<typeof setTimeout> | undefined;
    function onMouseDown(event: MouseEvent) {
      const dock = dockRef.current;
      if (dock && event.target instanceof Node && !dock.contains(event.target)) {
        event.preventDefault();
      }
    }
    function onBlur() {
      if (!empty) return;
      clearTimeout(blurTimer);
      blurTimer = setTimeout(() => {
        if (!document.hasFocus()) closeInput();
      }, BLUR_GRACE_MS);
    }
    function onFocus() {
      clearTimeout(blurTimer);
      (inputRef.current ?? settingsRef.current)?.focus();
    }
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(blurTimer);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [empty, closeInput]);

  // A reply on screen counts as activity; the timer starts once it is over.
  useEffect(() => {
    if (draft !== "" || busy) return;
    const timer = setTimeout(closeInput, IDLE_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [draft, busy, closeInput]);

  function send() {
    const text = draft.trim();
    if (text === "") return;
    setDraft("");
    void sendMessage(text);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter also confirms an IME's composition; that one must not send.
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      send();
    } else if (event.key === "ArrowUp" && draft === "") {
      const last = lastSentMessage();
      if (last !== null) {
        event.preventDefault();
        setDraft(last);
      }
    }
  }

  function onKeyDownAnywhere(event: KeyboardEvent<HTMLFieldSetElement>) {
    if (event.key === "Escape" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      closeInput();
    }
  }

  return (
    <fieldset ref={dockRef} className={styles.dock} onKeyDown={onKeyDownAnywhere}>
      {notice && (
        <p className={styles.notice} role="alert" {...hitRegion}>
          {notice}
        </p>
      )}
      {notReady ? (
        <div className={styles.pill} {...hitRegion}>
          <p className={styles.message}>{notReady}</p>
          <button
            ref={settingsRef}
            type="button"
            className={styles.action}
            onClick={() => {
              openSettings().catch((error: unknown) =>
                console.warn("failed to open settings", error),
              );
            }}
          >
            Settings
          </button>
        </div>
      ) : (
        <div className={styles.pill} {...hitRegion}>
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            value={draft}
            maxLength={MAX_MESSAGE_CHARS}
            placeholder="Say something…"
            aria-label="Message"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
      )}
    </fieldset>
  );
}
