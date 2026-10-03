// The model manifest: everything a loaded model actually has. Runtime code addresses
// parameters, expressions, motions and hit areas only through it.

import type { ModelSettings } from "@/live2d/modelSettings";

/** Parameters the app looks for. All are optional; features degrade when one is missing. */
export const STANDARD_PARAMETERS = [
  "ParamAngleX",
  "ParamAngleY",
  "ParamAngleZ",
  "ParamBodyAngleX",
  "ParamBodyAngleY",
  "ParamBodyAngleZ",
  "ParamEyeBallX",
  "ParamEyeBallY",
  "ParamEyeLOpen",
  "ParamEyeROpen",
  "ParamMouthOpenY",
  "ParamMouthForm",
  "ParamBreath",
  "ParamA",
  "ParamI",
  "ParamU",
  "ParamE",
  "ParamO",
] as const;

export type StandardParameter = (typeof STANDARD_PARAMETERS)[number];

/** A parameter as read from the moc. */
export interface MocParameter {
  id: string;
  min: number;
  max: number;
  default: number;
}

export interface ParameterInfo extends MocParameter {
  /** Display name from `cdi3.json`, when the model ships one. */
  name?: string;
}

export interface ModelManifest {
  parameters: ParameterInfo[];
  expressions: string[];
  motionGroups: { name: string; motions: string[] }[];
  hitAreas: { id: string; name: string }[];
  standardParameters: StandardParameter[];
}

/** Reads parameter display names from a `cdi3.json`, ignoring anything malformed. */
export function parseDisplayNames(json: unknown): Map<string, string> {
  const names = new Map<string, string>();
  if (typeof json !== "object" || json === null || !("Parameters" in json)) {
    return names;
  }
  const { Parameters } = json;
  if (!Array.isArray(Parameters)) {
    return names;
  }
  for (const item of Parameters) {
    if (typeof item !== "object" || item === null) continue;
    const { Id, Name } = item as Record<string, unknown>;
    if (typeof Id === "string" && typeof Name === "string" && Name.trim() !== "") {
      names.set(Id, Name);
    }
  }
  return names;
}

export interface ManifestInput {
  settings: ModelSettings;
  parameters: MocParameter[];
  /** Drawable IDs in the moc; hit areas pointing anywhere else are dropped. */
  drawableIds: ReadonlySet<string>;
  displayNames?: ReadonlyMap<string, string>;
}

export function buildManifest({
  settings,
  parameters,
  drawableIds,
  displayNames,
}: ManifestInput): ModelManifest {
  const parameterIds = new Set(parameters.map((p) => p.id));
  return {
    parameters: parameters.map((p) => {
      const name = displayNames?.get(p.id);
      return name === undefined ? { ...p } : { ...p, name };
    }),
    expressions: settings.expressions.map((e) => e.name),
    motionGroups: settings.motionGroups.map((g) => ({
      name: g.name,
      motions: g.motions.map((m) => m.file),
    })),
    hitAreas: settings.hitAreas
      .filter((h) => drawableIds.has(h.id))
      .map((h) => ({ id: h.id, name: h.name })),
    standardParameters: STANDARD_PARAMETERS.filter((id) => parameterIds.has(id)),
  };
}
