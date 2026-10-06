// Life layer 3: the model's expressions, cross-faded by the Framework. One expression shows
// at a time; clearing it cross-fades to an empty one, so the face eases back to whatever the
// layers below it pose.

import type { CubismModel } from "@cubism/framework/model/cubismmodel";
import { CubismExpressionMotion } from "@cubism/framework/motion/cubismexpressionmotion";
import { CubismExpressionMotionManager } from "@cubism/framework/motion/cubismexpressionmotionmanager";

// Used when the expression being cleared has no fade-out of its own.
const CLEAR_FADE_SECONDS = 0.5;

/** Fetches an expression file by name; undefined if the model has no such expression. */
export type ExpressionSource = (name: string) => Promise<ArrayBuffer | undefined>;

function parse(name: string, bytes: ArrayBuffer): CubismExpressionMotion | undefined {
  try {
    return CubismExpressionMotion.create(bytes, bytes.byteLength);
  } catch (error) {
    console.warn(`skipping expression ${name}: not a valid exp3.json`, error);
    return undefined;
  }
}

function emptyExpression(): CubismExpressionMotion {
  const json = JSON.stringify({ Type: "Live2D Expression", Parameters: [] });
  const bytes = new TextEncoder().encode(json).buffer;
  return CubismExpressionMotion.create(bytes, bytes.byteLength);
}

export class Expressions {
  private readonly manager = new CubismExpressionMotionManager();
  // Parsed once per name; undefined marks a file that failed, so it is not fetched again.
  private readonly loaded = new Map<string, CubismExpressionMotion | undefined>();
  private readonly empty = emptyExpression();
  private shown: CubismExpressionMotion | undefined;
  private request = 0;
  private released = false;
  /** The expression asked for last, shown once it has loaded. */
  current: string | null = null;

  constructor(private readonly source: ExpressionSource) {}

  /** Cross-fades to the expression `name`, or with null back to none. */
  set(name: string | null): void {
    if (name === this.current) return;
    this.current = name;
    const request = ++this.request;
    if (name === null) {
      this.show(undefined);
      return;
    }
    this.load(name).then(
      (expression) => {
        if (request === this.request && !this.released && expression) this.show(expression);
      },
      (error: unknown) => console.warn(`failed to load expression ${name}`, error),
    );
  }

  /** Applies the expressions to the model's parameters. */
  update(model: CubismModel, deltaSeconds: number): void {
    this.manager.updateMotion(model, deltaSeconds);
  }

  release(): void {
    this.released = true;
    this.manager.stopAllMotions();
    this.manager.release();
    for (const expression of this.loaded.values()) {
      expression?.release();
    }
    this.loaded.clear();
    this.empty.release();
  }

  private async load(name: string): Promise<CubismExpressionMotion | undefined> {
    if (this.loaded.has(name)) {
      return this.loaded.get(name);
    }
    const bytes = await this.source(name);
    if (this.released) return undefined;
    // A second request for the same name may have finished first.
    if (this.loaded.has(name)) return this.loaded.get(name);
    const expression = bytes && parse(name, bytes);
    this.loaded.set(name, expression);
    return expression;
  }

  private show(expression: CubismExpressionMotion | undefined): void {
    if (expression === this.shown) return;
    const previous = this.shown;
    this.shown = expression;
    if (expression) {
      this.manager.startMotion(expression, false);
      return;
    }
    // Fading in the empty expression fades the previous one out.
    this.empty.setFadeInTime(previous?.getFadeOutTime() || CLEAR_FADE_SECONDS);
    this.manager.startMotion(this.empty, false);
  }
}
