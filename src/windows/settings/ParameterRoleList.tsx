import { DRIVEN_PARAMETERS } from "@/live2d/life";
import type { ModelManifest } from "@/live2d/manifest";
import styles from "./ParameterRoleList.module.css";

type DrivenParameter = (typeof DRIVEN_PARAMETERS)[number];

const ROLE_LABELS: Record<DrivenParameter, string> = {
  ParamAngleX: "Head turn",
  ParamAngleY: "Head nod",
  ParamAngleZ: "Head tilt",
  ParamBodyAngleX: "Body turn",
  ParamBodyAngleY: "Body lean",
  ParamBodyAngleZ: "Body tilt",
  ParamEyeBallX: "Eyes across",
  ParamEyeBallY: "Eyes up/down",
  ParamBreath: "Breath",
};

type Roles = Partial<Record<string, string>>;

interface ParameterRoleListProps {
  /** Standard parameter id → the model's parameter that plays its role. */
  roles: Roles;
  manifest: ModelManifest;
  onChange: (roles: { [key in string]: string }) => void;
}

/**
 * Which of the model's parameters the gaze, sway, breathing and presets drive in place of
 * each standard one, for models that use their own ids.
 */
export function ParameterRoleList({ roles, manifest, onChange }: ParameterRoleListProps) {
  const known = new Set(manifest.parameters.map((p) => p.id));
  const driven: readonly string[] = DRIVEN_PARAMETERS;
  // Roles a pack maps that nothing drives yet stay in the mapping, shown read-only.
  const others = Object.entries(roles).filter(([role]) => !driven.includes(role));

  function setRole(role: string, id: string) {
    const rest = Object.entries(roles).filter(
      (entry): entry is [string, string] => entry[0] !== role && entry[1] !== undefined,
    );
    onChange(Object.fromEntries(id === "" ? rest : [...rest, [role, id]]));
  }

  return (
    <>
      <ul className={styles.roles}>
        {DRIVEN_PARAMETERS.map((role) => {
          const mapped = roles[role];
          const label = ROLE_LABELS[role];
          return (
            <li key={role} className={styles.role}>
              <span className={styles.name} title={role}>
                {label}
              </span>
              <select
                className={styles.select}
                value={mapped ?? ""}
                aria-label={label}
                onChange={(event) => setRole(role, event.target.value)}
              >
                <option value="">
                  {known.has(role) ? `${role} (standard)` : "Not in the model"}
                </option>
                {manifest.parameters
                  .filter((p) => p.id !== role)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name ? `${p.name} · ${p.id}` : p.id}
                    </option>
                  ))}
                {mapped !== undefined && !known.has(mapped) && (
                  <option value={mapped}>{mapped} (missing)</option>
                )}
              </select>
            </li>
          );
        })}
      </ul>
      {others.length > 0 && (
        <>
          <p className={styles.note}>Also in this mapping, not used yet:</p>
          <dl className={styles.others}>
            {others.map(([role, id]) => (
              <div key={role} className={styles.other}>
                <dt className={styles.name}>{role}</dt>
                <dd className={styles.otherId}>{id}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </>
  );
}
