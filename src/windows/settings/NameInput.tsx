import type { InputHTMLAttributes } from "react";
import styles from "./NameInput.module.css";

/** The longest display name; mirrors `MAX_DISPLAY_NAME_CHARS` in the core's `names.rs`. */
export const MAX_NAME_LENGTH = 64;

type NameInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "maxLength">;

/** A text field for a character's display name. */
export function NameInput({ className, ...props }: NameInputProps) {
  const classes = [styles.input, className].filter(Boolean).join(" ");
  return (
    <input
      type="text"
      maxLength={MAX_NAME_LENGTH}
      spellCheck={false}
      autoComplete="off"
      className={classes}
      {...props}
    />
  );
}
