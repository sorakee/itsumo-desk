import type { Target } from "@/ipc";
import type { ModelManifest } from "@/live2d/manifest";
import { PRESET_NAMES } from "@/live2d/presets";
import {
  groupLabel,
  PRESET_LABELS,
  parseTargetKey,
  type TargetKind,
  targetKey,
  targetOf,
  targetParts,
} from "@/windows/settings/mappingSlots";
import styles from "./TargetPicker.module.css";

interface Choice {
  key: string;
  label: string;
}

function choices<Name extends string>(
  kind: TargetKind,
  names: readonly Name[],
  label: (name: Name) => string,
): Choice[] {
  return names.map((name) => ({ key: targetKey(targetOf(kind, name)), label: label(name) }));
}

interface TargetPickerProps {
  /** Undefined when nothing is mapped. */
  target: Target | undefined;
  manifest: ModelManifest;
  /** Offers motion groups only (the idle slot). */
  motionsOnly?: boolean;
  /** Offers no "not mapped" choice; the picker starts with a prompt instead. */
  required?: boolean;
  /** What "not mapped" reads, e.g. what plays instead. */
  emptyLabel?: string;
  "aria-label": string;
  onChange: (target: Target | undefined) => void;
}

/** Picks an expression, a motion group or a preset of the model for a slot or entry. */
export function TargetPicker({
  target,
  manifest,
  motionsOnly = false,
  required = false,
  emptyLabel = "Not mapped",
  "aria-label": ariaLabel,
  onChange,
}: TargetPickerProps) {
  const groups: { label: string; kind: TargetKind; choices: Choice[] }[] = [
    {
      label: "Expressions",
      kind: "expression",
      choices: motionsOnly ? [] : choices("expression", manifest.expressions, (name) => name),
    },
    {
      label: "Motions",
      kind: "motion",
      choices: choices(
        "motion",
        manifest.motionGroups.map((g) => g.name),
        groupLabel,
      ),
    },
    {
      label: "Presets",
      kind: "preset",
      choices: motionsOnly ? [] : choices("preset", PRESET_NAMES, (name) => PRESET_LABELS[name]),
    },
  ];
  const value = targetKey(target);
  // A target the model lacks (a stale or hand-written mapping) stays visible and selected.
  if (target) {
    const { kind, name } = targetParts(target);
    const group = groups.find((g) => g.kind === kind);
    if (group && !group.choices.some((c) => c.key === value)) {
      const label = kind === "motion" ? groupLabel(name) : name;
      group.choices.push({ key: value, label: `${label} (missing)` });
    }
  }

  return (
    <select
      className={styles.select}
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => onChange(parseTargetKey(event.target.value))}
    >
      {required ? (
        <option value="" disabled>
          Choose what it plays…
        </option>
      ) : (
        <option value="">{emptyLabel}</option>
      )}
      {groups
        .filter((group) => group.choices.length > 0)
        .map((group) => (
          <optgroup key={group.kind} label={group.label}>
            {group.choices.map((choice) => (
              <option key={choice.key} value={choice.key}>
                {choice.label}
              </option>
            ))}
          </optgroup>
        ))}
    </select>
  );
}
