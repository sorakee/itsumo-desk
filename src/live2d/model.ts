// Loads a Cubism model from a `model3.json` URL and owns its GPU resources.

import { CubismMatrix44 } from "@cubism/framework/math/cubismmatrix44";
import { CubismMoc } from "@cubism/framework/model/cubismmoc";
import type { CubismModel } from "@cubism/framework/model/cubismmodel";
import { CubismUserModel } from "@cubism/framework/model/cubismusermodel";
import { CubismMotionManager } from "@cubism/framework/motion/cubismmotionmanager";
import { CUBISM_SHADER_PATH, startCubism } from "@/live2d/cubism";
import { Expressions } from "@/live2d/expressions";
import { type Bounds, boundsOf } from "@/live2d/framing";
import { type Clip, createClip, IdleLoop, idleGroup } from "@/live2d/idleMotion";
import { buildManifest, type ModelManifest, parseDisplayNames } from "@/live2d/manifest";
import {
  type ModelExtras,
  type ModelLayout,
  type ModelSettings,
  type MotionEntry,
  type MotionGroup,
  parseModelSettings,
  withExtras,
} from "@/live2d/modelSettings";

/** Where a model lives: the URL of its `model3.json`. Other files resolve relative to it. */
export interface ModelSource {
  /** Identifies the character for per-character settings such as framing. */
  id: string;
  url: string;
  /** Expressions and motions the character pack adds to the model. */
  extras?: ModelExtras;
}

// Drawables fainter than this do not count towards the model's visible extent.
const VISIBLE_OPACITY = 0.01;
// Above the idle loop's, which is on its own manager anyway; kept apart for when they share.
const TRIGGERED_PRIORITY = 2;

export class ModelLoadError extends Error {
  override name = "ModelLoadError";
}

function resolve(source: ModelSource, path: string): string {
  // Paths are validated relative paths; encoding each segment keeps `#`, `?` and `%` in file
  // names from being read as URL syntax.
  return new URL(path.split("/").map(encodeURIComponent).join("/"), source.url).href;
}

async function fetchOk(url: string, signal: AbortSignal): Promise<Response> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new ModelLoadError(`failed to fetch ${url}: HTTP ${response.status}`);
  }
  return response;
}

async function fetchBytes(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  return (await fetchOk(url, signal)).arrayBuffer();
}

/** Optional files degrade the model rather than failing the load. */
async function fetchOptional<T>(
  url: string | undefined,
  signal: AbortSignal,
  read: (response: Response) => Promise<T>,
): Promise<T | undefined> {
  if (url === undefined) {
    return undefined;
  }
  try {
    return await read(await fetchOk(url, signal));
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    console.warn(`skipping optional model file ${url}:`, error);
    return undefined;
  }
}

async function fetchBitmap(url: string, signal: AbortSignal): Promise<ImageBitmap> {
  const blob = await (await fetchOk(url, signal)).blob();
  // The renderer expects premultiplied textures in their stored orientation.
  return createImageBitmap(blob, { premultiplyAlpha: "premultiply", colorSpaceConversion: "none" });
}

function createTexture(gl: WebGL2RenderingContext, bitmap: ImageBitmap): WebGLTexture {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}

async function fetchSettings(source: ModelSource, signal: AbortSignal): Promise<ModelSettings> {
  const json: unknown = await (await fetchOk(source.url, signal)).json();
  return withExtras(parseModelSettings(json), source.extras);
}

/** Reads the manifest from a moc the Core has loaded. */
function manifestOf(
  settings: ModelSettings,
  core: Live2DCubismCore.Model,
  displayInfo: unknown,
): ModelManifest {
  const { parameters, drawables } = core;
  return buildManifest({
    settings,
    parameters: parameters.ids.map((id, i) => ({
      id,
      min: parameters.minimumValues[i] ?? 0,
      max: parameters.maximumValues[i] ?? 0,
      default: parameters.defaultValues[i] ?? 0,
    })),
    drawableIds: new Set(drawables.ids),
    displayNames: parseDisplayNames(displayInfo),
  });
}

/**
 * Builds a model's manifest without rendering it (no textures, no WebGL), e.g. to validate
 * an import.
 */
export async function inspectModel(
  source: ModelSource,
  signal: AbortSignal,
): Promise<ModelManifest> {
  await startCubism();
  const settings = await fetchSettings(source, signal);
  const at = (path: string | undefined) => (path === undefined ? undefined : resolve(source, path));
  const [moc, displayInfo] = await Promise.all([
    fetchBytes(resolve(source, settings.moc), signal),
    fetchOptional(at(settings.displayInfo), signal, (r) => r.json()),
  ]);
  signal.throwIfAborted();
  // The Framework's declarations are compiled without strictNullChecks; both can be null.
  const cubismMoc: CubismMoc | null = CubismMoc.create(moc, true);
  if (!cubismMoc) {
    throw mocError(moc);
  }
  const model: CubismModel | null = cubismMoc.createModel();
  try {
    if (!model) {
      throw mocError(moc);
    }
    return manifestOf(settings, model.getModel(), displayInfo);
  } finally {
    if (model) cubismMoc.deleteModel(model);
    CubismMoc.delete(cubismMoc);
  }
}

export interface LoadedModel {
  model: Live2DModel;
  manifest: ModelManifest;
}

export class Live2DModel extends CubismUserModel {
  private readonly textures: WebGLTexture[] = [];
  private readonly mvp = new CubismMatrix44();
  /** From model3.json, when the author set one. */
  layout: ModelLayout | undefined;
  private idle: IdleLoop | undefined;
  // The group the idle loop plays from, and which request for its clips is the latest.
  private idleSource: MotionGroup | undefined;
  private idleRequest = 0;
  private expressions: Expressions | undefined;
  // Motions played on request (previews now, slots later), over the idle loop.
  private readonly triggered = new CubismMotionManager();
  private triggeredClip: Clip | undefined;
  private readonly clips = new Map<string, Promise<Clip | undefined>>();
  // Aborts the fetches of expressions and motions still loading when the model goes.
  private readonly loads = new AbortController();
  // Set once the moc has loaded.
  private manifest: ModelManifest | undefined;

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly source: ModelSource,
    private readonly settings: ModelSettings,
  ) {
    super();
  }

  /** Width over height of the model canvas. */
  get aspectRatio(): number {
    const model = this.getModel();
    return model.getCanvasWidth() / model.getCanvasHeight();
  }

  static async load(
    gl: WebGL2RenderingContext,
    source: ModelSource,
    signal: AbortSignal,
  ): Promise<LoadedModel> {
    const settings = await fetchSettings(source, signal);
    const at = (path: string | undefined) =>
      path === undefined ? undefined : resolve(source, path);

    const [moc, bitmaps, physics, pose, displayInfo] = await Promise.all([
      fetchBytes(resolve(source, settings.moc), signal),
      Promise.all(settings.textures.map((path) => fetchBitmap(resolve(source, path), signal))),
      fetchOptional(at(settings.physics), signal, (r) => r.arrayBuffer()),
      fetchOptional(at(settings.pose), signal, (r) => r.arrayBuffer()),
      fetchOptional(at(settings.displayInfo), signal, (r) => r.json()),
    ]);

    const model = new Live2DModel(gl, source, settings);
    try {
      signal.throwIfAborted();
      // The consistency check guards the Core against malformed third-party mocs.
      model.loadModel(moc, true);
      if (!model.getModel()) {
        throw mocError(moc);
      }
      const manifest = manifestOf(settings, model.getModel().getModel(), displayInfo);
      model.manifest = manifest;
      model.expressions = new Expressions((name) => model.fetchExpression(name));
      model.centerCanvas();
      model.layout = settings.layout;
      // Rests until `setIdleGroup` gives it clips.
      model.idle = new IdleLoop(model._motionManager, []);

      if (physics) {
        model.loadPhysics(physics, physics.byteLength);
        model._physics.stabilization(model.getModel());
      }
      if (pose) {
        model.loadPose(pose, pose.byteLength);
      }
      model.createRenderer(gl.drawingBufferWidth, gl.drawingBufferHeight);
      const renderer = model.getRenderer();
      renderer.startUp(gl);
      renderer.setIsPremultipliedAlpha(true);
      bitmaps.forEach((bitmap, index) => {
        const texture = createTexture(gl, bitmap);
        model.textures.push(texture);
        renderer.bindTexture(index, texture);
      });
      return { model, manifest };
    } catch (error) {
      model.release();
      throw error;
    } finally {
      for (const bitmap of bitmaps) {
        bitmap.close();
      }
    }
  }

  /**
   * Puts the centre of the model canvas at the origin. Core coordinates are relative to the
   * canvas origin, which the editor lets authors place anywhere.
   */
  private centerCanvas(): void {
    const { CanvasWidth, CanvasHeight, CanvasOriginX, CanvasOriginY, PixelsPerUnit } =
      this.getModel().getModel().canvasinfo;
    const matrix = this.getModelMatrix();
    const scale = matrix.getScaleY();
    matrix.translate(
      ((CanvasOriginX - CanvasWidth / 2) / PixelsPerUnit) * scale,
      ((CanvasHeight / 2 - CanvasOriginY) / PixelsPerUnit) * scale,
    );
  }

  /** The extent of each visible drawable in model units, as currently posed. */
  drawableBounds(): Bounds[] {
    const model = this.getModel();
    const all: Bounds[] = [];
    for (let i = 0; i < model.getDrawableCount(); i++) {
      if (
        !model.getDrawableDynamicFlagIsVisible(i) ||
        model.getDrawableOpacity(i) <= VISIBLE_OPACITY
      ) {
        continue;
      }
      const bounds = this.boundsOfDrawable(i);
      if (bounds) {
        all.push(bounds);
      }
    }
    return all;
  }

  /** The extent of a drawable in model units, visible or not (hit areas are often hidden). */
  drawableBoundsById(id: string): Bounds | undefined {
    const index = this.getModel().getModel().drawables.ids.indexOf(id);
    return index < 0 ? undefined : this.boundsOfDrawable(index);
  }

  private boundsOfDrawable(index: number): Bounds | undefined {
    const bounds = boundsOf(this.getModel().getDrawableVertices(index));
    // The model matrix only scales and translates, so the corners map to corners.
    const matrix = this.getModelMatrix();
    return (
      bounds && {
        left: matrix.transformX(bounds.left),
        right: matrix.transformX(bounds.right),
        bottom: matrix.transformY(bounds.bottom),
        top: matrix.transformY(bounds.top),
      }
    );
  }

  /** Whether the motion playing now blinks by itself. */
  get motionBlinks(): boolean {
    if (this.triggeredClip && !this.triggered.isFinished()) {
      return this.triggeredClip.blinks;
    }
    return this.idle?.blinks ?? false;
  }

  /** The expression asked for last, if any. */
  get expression(): string | null {
    return this.expressions?.current ?? null;
  }

  /** Cross-fades to the expression `name`, or back to none. Unknown names are ignored. */
  setExpression(name: string | null): void {
    if (name !== null && !this.settings.expressions.some((e) => e.name === name)) return;
    this.expressions?.set(name);
  }

  /**
   * Plays the idle loop from the group the mapping's `idle` slot names (`mapped`), or from
   * the "Idle" group when the model has no such group. The clips load in the background.
   */
  setIdleGroup(mapped: string | undefined): void {
    const group = idleGroup(this.settings.motionGroups, mapped);
    if (group === this.idleSource && this.idleRequest > 0) return;
    this.idleSource = group;
    const request = ++this.idleRequest;
    Promise.all((group?.motions ?? []).map((entry) => this.loadClip(entry))).then((clips) => {
      if (request !== this.idleRequest || this.loads.signal.aborted) return;
      this.idle?.setClips(clips.filter((clip) => clip !== undefined));
    });
  }

  /**
   * Plays motion `index` of `group` once, over the idle motion. Unknown motions and files
   * that fail to load are skipped.
   */
  playMotion(group: string, index: number): void {
    const entry = this.settings.motionGroups.find((g) => g.name === group)?.motions[index];
    if (!entry) return;
    this.loadClip(entry).then((clip) => {
      if (!clip || this.loads.signal.aborted) return;
      this.triggeredClip = clip;
      this.triggered.startMotionPriority(clip.motion, false, TRIGGERED_PRIORITY);
    });
  }

  /**
   * Plays the motions (life layers 1 and 3) on the default pose. Every frame starts from
   * the defaults, so the layers written on top before `update` do not accumulate and a
   * motion fades in from, and back out to, the rest pose rather than freezing where it
   * stopped. `quiet` fades the idle motion out, e.g. while a preset plays; so does a
   * triggered motion.
   */
  updateMotion(deltaSeconds: number, quiet: boolean): void {
    const model = this.getModel();
    const { parameters } = model.getModel();
    parameters.values.set(parameters.defaultValues);
    this.idle?.update(model, deltaSeconds, quiet || !this.triggered.isFinished());
    this.triggered.updateMotion(model, deltaSeconds);
    this.expressions?.update(model, deltaSeconds);
  }

  private async fetchExpression(name: string): Promise<ArrayBuffer | undefined> {
    const entry = this.settings.expressions.find((e) => e.name === name);
    return entry && fetchBytes(resolve(this.source, entry.file), this.loads.signal);
  }

  private loadClip(entry: MotionEntry): Promise<Clip | undefined> {
    let clip = this.clips.get(entry.file);
    if (!clip) {
      const manifest = this.manifest;
      clip = fetchBytes(resolve(this.source, entry.file), this.loads.signal).then(
        (bytes) => (manifest ? createClip(bytes, entry, manifest) : undefined),
        (error: unknown) => {
          if (!this.loads.signal.aborted)
            console.warn(`failed to load motion ${entry.file}`, error);
          return undefined;
        },
      );
      this.clips.set(entry.file, clip);
    }
    return clip;
  }

  /** Advances physics and pose by `deltaSeconds` and applies the parameters. */
  update(deltaSeconds: number): void {
    const model = this.getModel();
    this._physics?.evaluate(model, deltaSeconds);
    this._pose?.updateParameters(model, deltaSeconds);
    model.update();
  }

  draw(projection: CubismMatrix44, viewport: [number, number, number, number]): void {
    this.mvp.setMatrix(projection.getArray());
    this.mvp.multiplyByMatrix(this.getModelMatrix());
    const renderer = this.getRenderer();
    renderer.setMvpMatrix(this.mvp);
    // The Framework's declarations are compiled without strictNullChecks; null selects the
    // default framebuffer, which is what the canvas draws to.
    renderer.setRenderState(null as unknown as WebGLFramebuffer, viewport);
    renderer.drawModel(CUBISM_SHADER_PATH);
  }

  override release(): void {
    this.loads.abort();
    this.idle?.release();
    this.idle = undefined;
    this.expressions?.release();
    this.expressions = undefined;
    this.triggered.stopAllMotions();
    this.triggeredClip = undefined;
    for (const clip of this.clips.values()) {
      clip.then((loaded) => loaded?.motion.release());
    }
    this.clips.clear();
    for (const texture of this.textures) {
      this.gl.deleteTexture(texture);
    }
    this.textures.length = 0;
    super.release();
  }
}

function mocError(bytes: ArrayBuffer): ModelLoadError {
  const version = CubismMoc.getMocVersionFromBuffer(bytes);
  const latest = Live2DCubismCore.Version.csmGetLatestMocVersion();
  return new ModelLoadError(
    version > latest
      ? `moc3 version ${version} is newer than this Cubism Core supports (${latest})`
      : "moc3 file is corrupt or not a Cubism 3+ model",
  );
}
