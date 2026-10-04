// Tolerant parser for `model3.json`. Model files come from third parties, so anything
// malformed is dropped rather than trusted; only a missing moc or texture list is fatal.

export interface MotionEntry {
  file: string;
  fadeInTime?: number;
  fadeOutTime?: number;
  sound?: string;
}

export interface MotionGroup {
  name: string;
  motions: MotionEntry[];
}

export interface ExpressionEntry {
  name: string;
  file: string;
}

export interface HitAreaEntry {
  id: string;
  name: string;
}

/** A named parameter group, e.g. `EyeBlink` or `LipSync`. */
export interface ParameterGroup {
  name: string;
  ids: string[];
}

/** Where the model sits in the view, in view units (the view is 2 units tall). */
export interface ModelLayout {
  width?: number;
  height?: number;
  centerY?: number;
  top?: number;
  bottom?: number;
  y?: number;
}

export interface ModelSettings {
  moc: string;
  textures: string[];
  physics?: string;
  pose?: string;
  displayInfo?: string;
  userData?: string;
  expressions: ExpressionEntry[];
  motionGroups: MotionGroup[];
  hitAreas: HitAreaEntry[];
  groups: ParameterGroup[];
  layout?: ModelLayout;
}

export class ModelSettingsError extends Error {
  override name = "ModelSettingsError";
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Normalises a file reference to a relative path inside the model folder, or returns
 * undefined if it is absolute, has a URL scheme, or climbs out with `..`.
 */
export function safeRelativePath(value: unknown): string | undefined {
  const raw = nonEmptyString(value);
  if (raw === undefined || raw.includes("\0")) {
    return undefined;
  }
  const path = raw.replaceAll("\\", "/");
  if (path.startsWith("/") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) {
    return undefined;
  }
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      return undefined;
    }
    segments.push(segment);
  }
  return segments.length > 0 ? segments.join("/") : undefined;
}

function parseMotion(value: unknown): MotionEntry | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  const file = safeRelativePath(value.File);
  if (file === undefined) {
    return undefined;
  }
  return {
    file,
    fadeInTime: finiteNumber(value.FadeInTime),
    fadeOutTime: finiteNumber(value.FadeOutTime),
    sound: safeRelativePath(value.Sound),
  };
}

function parseMotionGroups(value: unknown): MotionGroup[] {
  if (!isObject(value)) {
    return [];
  }
  const groups: MotionGroup[] = [];
  for (const [name, motions] of Object.entries(value)) {
    const entries = asArray(motions)
      .map(parseMotion)
      .filter((m) => m !== undefined);
    if (entries.length > 0) {
      groups.push({ name, motions: entries });
    }
  }
  return groups;
}

function parseExpressions(value: unknown): ExpressionEntry[] {
  const seen = new Set<string>();
  const expressions: ExpressionEntry[] = [];
  for (const item of asArray(value)) {
    if (!isObject(item)) continue;
    const name = nonEmptyString(item.Name);
    const file = safeRelativePath(item.File);
    if (name === undefined || file === undefined || seen.has(name)) continue;
    seen.add(name);
    expressions.push({ name, file });
  }
  return expressions;
}

function parseHitAreas(value: unknown): HitAreaEntry[] {
  const hitAreas: HitAreaEntry[] = [];
  for (const item of asArray(value)) {
    if (!isObject(item)) continue;
    const id = nonEmptyString(item.Id);
    if (id === undefined) continue;
    hitAreas.push({ id, name: nonEmptyString(item.Name) ?? id });
  }
  return hitAreas;
}

function parseGroups(value: unknown): ParameterGroup[] {
  const groups: ParameterGroup[] = [];
  for (const item of asArray(value)) {
    if (!isObject(item) || item.Target !== "Parameter") continue;
    const name = nonEmptyString(item.Name);
    if (name === undefined) continue;
    const ids = asArray(item.Ids).filter((id): id is string => nonEmptyString(id) !== undefined);
    groups.push({ name, ids });
  }
  return groups;
}

// The Framework matches lower-case keys (`center_y`) while editors write `CenterY`; accept
// either spelling.
const LAYOUT_KEYS = new Map<string, keyof ModelLayout>([
  ["width", "width"],
  ["height", "height"],
  ["centery", "centerY"],
  ["top", "top"],
  ["bottom", "bottom"],
  ["y", "y"],
]);

function parseLayout(value: unknown): ModelLayout | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  const layout: ModelLayout = {};
  let found = false;
  for (const [key, raw] of Object.entries(value)) {
    const field = LAYOUT_KEYS.get(key.toLowerCase().replaceAll("_", ""));
    const number = finiteNumber(raw);
    if (field !== undefined && number !== undefined) {
      layout[field] = number;
      found = true;
    }
  }
  return found ? layout : undefined;
}

export function parseModelSettings(json: unknown): ModelSettings {
  if (!isObject(json) || !isObject(json.FileReferences)) {
    throw new ModelSettingsError("model3.json has no FileReferences");
  }
  const refs = json.FileReferences;

  const moc = safeRelativePath(refs.Moc);
  if (moc === undefined) {
    throw new ModelSettingsError("model3.json has no valid Moc reference");
  }
  const textures = asArray(refs.Textures).map(safeRelativePath);
  // Texture indices are positional, so one bad entry invalidates the rest.
  if (textures.length === 0 || textures.some((t) => t === undefined)) {
    throw new ModelSettingsError("model3.json has missing or invalid Textures");
  }

  return {
    moc,
    textures: textures.filter((t) => t !== undefined),
    expressions: parseExpressions(refs.Expressions),
    motionGroups: parseMotionGroups(refs.Motions),
    hitAreas: parseHitAreas(json.HitAreas),
    groups: parseGroups(json.Groups),
    layout: parseLayout(json.Layout),
    physics: safeRelativePath(refs.Physics),
    pose: safeRelativePath(refs.Pose),
    displayInfo: safeRelativePath(refs.DisplayInfo),
    userData: safeRelativePath(refs.UserData),
  };
}

/**
 * Expressions and motions a character pack adds to its model (`modelExtras` in
 * `character.json`), for exports such as VTube Studio's that leave them out of
 * `model3.json`. Paths are relative to the `model3.json`.
 */
export interface ModelExtras {
  expressions: { name: string; file: string }[];
  motionGroups: { name: string; motions: { file: string }[] }[];
}

/**
 * Merges a pack's extras into the parsed `model3.json`. The model's own entries win: an
 * expression name or a motion file it already has is not added twice.
 */
export function withExtras(
  settings: ModelSettings,
  extras: ModelExtras | undefined,
): ModelSettings {
  if (!extras) {
    return settings;
  }
  const expressions = [...settings.expressions];
  const names = new Set(expressions.map((e) => e.name));
  for (const { name, file } of extras.expressions) {
    const path = safeRelativePath(file);
    if (path === undefined || name.trim() === "" || names.has(name)) continue;
    names.add(name);
    expressions.push({ name, file: path });
  }

  const motionGroups = settings.motionGroups.map((g) => ({ ...g, motions: [...g.motions] }));
  for (const group of extras.motionGroups) {
    const motions = group.motions
      .map((m) => safeRelativePath(m.file))
      .filter((file) => file !== undefined)
      .map((file) => ({ file }));
    const existing = motionGroups.find((g) => g.name === group.name);
    if (existing) {
      const known = new Set(existing.motions.map((m) => m.file));
      existing.motions.push(...motions.filter((m) => !known.has(m.file)));
    } else if (motions.length > 0) {
      motionGroups.push({ name: group.name, motions });
    }
  }
  return { ...settings, expressions, motionGroups };
}
