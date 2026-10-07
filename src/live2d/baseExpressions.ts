// Base expressions (D45): expressions a mapping applies at rest, such as toggles that hide a
// watermark or pick an outfit. Several apply at once, which the Framework's expression manager
// cannot do (starting one fades the others out), so they are blended here, after the motions
// and before layer 3, whose expression then adds to or overrides them.

import type { ExpressionSource } from "@/live2d/expressions";
import type { ModelParameters } from "@/live2d/parameters";

type Blend = "add" | "multiply" | "overwrite";

export interface ExpressionData {
  fadeIn: number;
  fadeOut: number;
  parameters: { id: string; value: number; blend: Blend }[];
}

// What Cubism uses when an exp3.json gives no fade time.
const DEFAULT_FADE_SECONDS = 1;

function fadeTime(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_FADE_SECONDS;
}

/** As in Cubism, anything but `Multiply` or `Overwrite` adds. */
function blendOf(value: unknown): Blend {
  if (value === "Multiply") return "multiply";
  if (value === "Overwrite") return "overwrite";
  return "add";
}

/** Reads an exp3.json, keeping the parameters it can; undefined if it is not one. */
export function parseExpression(json: unknown): ExpressionData | undefined {
  if (typeof json !== "object" || json === null) return undefined;
  const { FadeInTime, FadeOutTime, Parameters } = json as Record<string, unknown>;
  if (!Array.isArray(Parameters)) return undefined;
  const parameters = Parameters.flatMap((item: unknown) => {
    if (typeof item !== "object" || item === null) return [];
    const { Id, Value, Blend } = item as Record<string, unknown>;
    return typeof Id === "string" && typeof Value === "number" && Number.isFinite(Value)
      ? [{ id: Id, value: Value, blend: blendOf(Blend) }]
      : [];
  });
  return { fadeIn: fadeTime(FadeInTime), fadeOut: fadeTime(FadeOutTime), parameters };
}

interface Applied {
  data: ExpressionData;
  /** How far the fade has got, 0 to 1; eased into the weight. */
  progress: number;
  on: boolean;
}

/** Cubism's fade curve. */
function easeSine(t: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}

export class BaseExpressions {
  // Parsed once per name; undefined marks a file that failed, so it is not fetched again.
  private readonly loaded = new Map<string, Promise<ExpressionData | undefined>>();
  // In the order they were turned on, which decides between two that overwrite one parameter.
  private readonly applied = new Map<string, Applied>();
  private request = 0;
  private released = false;

  constructor(private readonly source: ExpressionSource) {}

  /**
   * Fades the expressions `names` in and any others out; with `immediate`, they switch at
   * once, e.g. before a model's first frame. Resolves once the files have loaded; names that
   * fail to load are skipped. A later call supersedes one still loading.
   */
  async set(names: readonly string[], immediate = false): Promise<void> {
    const request = ++this.request;
    const loaded = await Promise.all(names.map((name) => this.load(name)));
    if (request !== this.request || this.released) return;

    const wanted = new Map<string, ExpressionData>();
    names.forEach((name, i) => {
      const data = loaded[i];
      if (data) wanted.set(name, data);
    });
    for (const [name, applied] of this.applied) {
      if (wanted.has(name)) continue;
      applied.on = false;
      if (immediate) this.applied.delete(name);
    }
    for (const [name, data] of wanted) {
      const applied = this.applied.get(name);
      if (applied) {
        applied.on = true;
        if (immediate) applied.progress = 1;
      } else {
        this.applied.set(name, { data, progress: immediate ? 1 : 0, on: true });
      }
    }
  }

  /** Advances the fades by `deltaSeconds` and applies the expressions to `params`. */
  update(deltaSeconds: number, params: ModelParameters): void {
    for (const [name, applied] of this.applied) {
      const fade = applied.on ? applied.data.fadeIn : applied.data.fadeOut;
      const step = fade > 0 ? deltaSeconds / fade : 1;
      applied.progress = Math.min(1, Math.max(0, applied.progress + (applied.on ? step : -step)));
      if (!applied.on && applied.progress === 0) {
        this.applied.delete(name);
        continue;
      }
      const weight = easeSine(applied.progress);
      for (const { id, value, blend } of applied.data.parameters) {
        switch (blend) {
          case "add":
            params.add(id, value * weight);
            break;
          case "multiply":
            params.multiply(id, 1 + (value - 1) * weight);
            break;
          case "overwrite":
            params.set(id, value, weight);
            break;
        }
      }
    }
  }

  release(): void {
    this.released = true;
    this.applied.clear();
    this.loaded.clear();
  }

  private load(name: string): Promise<ExpressionData | undefined> {
    let data = this.loaded.get(name);
    if (!data) {
      data = this.source(name).then(
        (bytes) => {
          const parsed = bytes && parseExpression(parseJson(bytes));
          if (bytes && !parsed) console.warn(`skipping base expression ${name}: not an exp3.json`);
          return parsed;
        },
        (error: unknown) => {
          if (!this.released) console.warn(`failed to load base expression ${name}`, error);
          return undefined;
        },
      );
      this.loaded.set(name, data);
    }
    return data;
  }
}

function parseJson(bytes: ArrayBuffer): unknown {
  try {
    // The decoder drops a byte order mark, which some exporters write.
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}
