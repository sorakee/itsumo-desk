import type { Mapping, Target } from "@/ipc";
import {
  BEHAVIOUR_SLOTS,
  describeTarget,
  EMOTION_SLOTS,
  type SlotInfo,
} from "@/windows/settings/mappingSlots";
import { Panel } from "@/windows/settings/Panel";
import styles from "./MappingSummary.module.css";

function targetText(target: Target | undefined) {
  if (!target) {
    return <span className={styles.unmapped}>Not mapped</span>;
  }
  const { kind, name } = describeTarget(target);
  return (
    <>
      <span className={styles.kind}>{kind}</span> {name}
    </>
  );
}

function slotList(slots: readonly SlotInfo[], mapping: Mapping) {
  return (
    <dl className={styles.slots}>
      {slots.map(({ id, label }) => (
        <div key={id} className={styles.slot}>
          <dt className={styles.slotName}>{label}</dt>
          <dd className={styles.target}>{targetText(mapping.slots[id])}</dd>
        </div>
      ))}
    </dl>
  );
}

interface MappingSummaryProps {
  /** Null when the character has no mapping. */
  mapping: Mapping | null;
  warnings: string[];
}

/** The character's mapping, read-only. */
export function MappingSummary({ mapping, warnings }: MappingSummaryProps) {
  const parameters = mapping ? Object.entries(mapping.parameters) : [];
  return (
    <Panel title="Mapping" hint="What the character plays for the app's slots and its own entries.">
      {mapping === null ? (
        <p className={styles.empty}>This character has no mapping yet.</p>
      ) : (
        <>
          <h3 className={styles.heading}>Behaviour</h3>
          {slotList(BEHAVIOUR_SLOTS, mapping)}
          <h3 className={styles.heading}>Emotions</h3>
          {slotList(EMOTION_SLOTS, mapping)}
          {mapping.custom.length > 0 && (
            <>
              <h3 className={styles.heading}>Custom</h3>
              <dl className={styles.slots}>
                {mapping.custom.map((entry) => (
                  <div key={entry.name} className={styles.slot}>
                    <dt className={styles.slotName}>{entry.name}</dt>
                    <dd className={styles.target}>
                      {targetText(entry.target)}
                      {entry.description && (
                        <span className={styles.description}>{entry.description}</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          {parameters.length > 0 && (
            <>
              <h3 className={styles.heading}>Parameters</h3>
              <dl className={styles.slots}>
                {parameters.map(([role, id]) => (
                  <div key={role} className={styles.slot}>
                    <dt className={styles.slotName}>{role}</dt>
                    <dd className={styles.target}>{id}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </>
      )}
      {warnings.length > 0 && (
        <ul className={styles.warnings}>
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
