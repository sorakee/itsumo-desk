import { useEffect, useRef } from "react";
import type { Preset, PresetInfo } from "@/ipc";
import styles from "./PresetPicker.module.css";

interface PresetPickerProps {
  presets: PresetInfo[];
  onPick: (preset: Preset) => void;
  onCancel: () => void;
}

/** The presets a new provider profile can start from. */
export function PresetPicker({ presets, onPick, onCancel }: PresetPickerProps) {
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  // Escape closes it wherever focus went after opening it, not only from its own buttons.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className={styles.picker}>
      {presets.map((info, index) => (
        <button
          key={info.preset}
          ref={index === 0 ? first : undefined}
          type="button"
          className={styles.preset}
          onClick={() => onPick(info.preset)}
        >
          <span className={styles.label}>{info.label}</span>
          <span className={styles.detail}>
            {info.baseUrl || "Any OpenAI-compatible server"}
            {!info.needsKey && " · no key"}
          </span>
        </button>
      ))}
    </div>
  );
}
