import { type ReactNode, useId } from "react";
import styles from "./Panel.module.css";

interface PanelProps {
  title: string;
  /** Shown after the title, e.g. how many items the panel lists. */
  count?: number;
  hint?: string;
  children: ReactNode;
}

/** A titled card in the mapping view. */
export function Panel({ title, count, hint, children }: PanelProps) {
  const titleId = useId();
  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.title}>
        {title}
        {count !== undefined && <span className={styles.count}>{count}</span>}
      </h2>
      {hint && <p className={styles.hint}>{hint}</p>}
      <div className={styles.body}>{children}</div>
    </section>
  );
}
