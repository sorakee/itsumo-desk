import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

export type ButtonTone = "primary" | "secondary" | "danger";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  tone?: ButtonTone;
}

/** The settings window's push button. Never submits a form. */
export function Button({ tone = "secondary", className, ...props }: ButtonProps) {
  const classes = [styles.button, styles[tone], className].filter(Boolean).join(" ");
  return <button type="button" className={classes} {...props} />;
}
