import type { ModelManifest } from "@/live2d/manifest";
import styles from "./BaseExpressionList.module.css";

interface BaseExpressionListProps {
  /** The expressions applied at rest, in the order they were picked. */
  names: readonly string[];
  manifest: ModelManifest;
  onChange: (names: string[]) => void;
}

/** Checkboxes for the expressions the character wears at rest. */
export function BaseExpressionList({ names, manifest, onChange }: BaseExpressionListProps) {
  // Names the model lacks (a stale or hand-written mapping) stay listed so they can be removed.
  const missing = names.filter((name) => !manifest.expressions.includes(name));
  const all = [...manifest.expressions, ...missing];

  if (all.length === 0) {
    return <p className={styles.empty}>This model has no expressions.</p>;
  }

  function toggle(name: string, on: boolean) {
    onChange(on ? [...names, name] : names.filter((n) => n !== name));
  }

  return (
    <ul className={styles.list}>
      {all.map((name) => (
        <li key={name}>
          <label className={styles.option}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={names.includes(name)}
              onChange={(event) => toggle(name, event.target.checked)}
            />
            <span className={styles.label} title={name}>
              {missing.includes(name) ? `${name} (missing)` : name}
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}
