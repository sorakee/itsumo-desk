// Loads a Cubism model from a `model3.json` URL and owns its GPU resources.

import { CubismMatrix44 } from "@cubism/framework/math/cubismmatrix44";
import { CubismMoc } from "@cubism/framework/model/cubismmoc";
import { CubismUserModel } from "@cubism/framework/model/cubismusermodel";
import { CUBISM_SHADER_PATH } from "@/live2d/cubism";
import { buildManifest, type ModelManifest, parseDisplayNames } from "@/live2d/manifest";
import { parseModelSettings } from "@/live2d/modelSettings";

/** Where a model lives: the URL of its `model3.json`. Other files resolve relative to it. */
export interface ModelSource {
  url: string;
}

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

export interface LoadedModel {
  model: Live2DModel;
  manifest: ModelManifest;
}

export class Live2DModel extends CubismUserModel {
  private readonly textures: WebGLTexture[] = [];
  private readonly mvp = new CubismMatrix44();

  private constructor(private readonly gl: WebGL2RenderingContext) {
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
    const settings = parseModelSettings(await (await fetchOk(source.url, signal)).json());
    const at = (path: string | undefined) =>
      path === undefined ? undefined : resolve(source, path);

    const [moc, bitmaps, physics, pose, displayInfo] = await Promise.all([
      fetchBytes(resolve(source, settings.moc), signal),
      Promise.all(settings.textures.map((path) => fetchBitmap(resolve(source, path), signal))),
      fetchOptional(at(settings.physics), signal, (r) => r.arrayBuffer()),
      fetchOptional(at(settings.pose), signal, (r) => r.arrayBuffer()),
      fetchOptional(at(settings.displayInfo), signal, (r) => r.json()),
    ]);

    const model = new Live2DModel(gl);
    try {
      signal.throwIfAborted();
      // The consistency check guards the Core against malformed third-party mocs.
      model.loadModel(moc, true);
      if (!model.getModel()) {
        throw mocError(moc);
      }
      const { parameters, drawables } = model.getModel().getModel();
      const manifest = buildManifest({
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
      model.centerCanvas();

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
