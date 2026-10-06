// The stage owns a canvas, its WebGL context and the render loop. React talks to it only
// through this small imperative API and never re-renders per frame.

import { CubismMatrix44 } from "@cubism/framework/math/cubismmatrix44";
import { CubismRenderer_WebGL } from "@cubism/framework/rendering/cubismrenderer_webgl";
import { startCubism } from "@/live2d/cubism";
import {
  type Bounds,
  clampFraming,
  defaultFraming,
  type Framing,
  faceAnchor,
  type ModelPoint,
  modelToWindow,
  panFraming,
  unionOf,
  zoomFraming,
} from "@/live2d/framing";
import { type GazeVector, gazeTowards } from "@/live2d/gaze";
import { Life } from "@/live2d/life";
import type { ModelManifest } from "@/live2d/manifest";
import { Live2DModel, type LoadedModel, type ModelSource } from "@/live2d/model";
import { ModelParameters } from "@/live2d/parameters";
import type { PresetName } from "@/live2d/presets";

/** CSS pixels relative to the viewport. */
export interface Point {
  x: number;
  y: number;
}

export interface Stage {
  /**
   * Replaces the current model and resolves with the new model's manifest. `framing`
   * overrides the model's default framing. A load that is superseded by another `load` or
   * by `dispose` rejects with an `AbortError`.
   */
  load(source: ModelSource, framing?: Framing): Promise<ModelManifest>;
  /** The manifest of the model on stage, if any. */
  readonly manifest: ModelManifest | undefined;
  /** The source of the model on stage, if any. */
  readonly source: ModelSource | undefined;
  /** How the model on stage is framed, if any. */
  readonly framing: Framing | undefined;
  /** Zooms the framing by `factor`, keeping the model point at viewport height `anchorY` still. */
  zoomFraming(factor: number, anchorY: number): void;
  /** Moves the model by `dx` right and `dy` down, in CSS pixels. */
  panFraming(dx: number, dy: number): void;
  /** Goes back to the model's default framing. */
  resetFraming(): void;
  /** Frames the model as `framing` says, kept on the model. */
  setFraming(framing: Framing): void;
  /**
   * Where the cursor is, or null when it is outside the window. The stage tests whether the
   * model is drawn under it and reports changes to `onHitChange` listeners.
   */
  setPointer(point: Point | null): void;
  onHitChange(listener: (hit: boolean) => void): () => void;
  /** Where the cursor is, inside the window or not, for the gaze to follow. */
  setCursor(point: Point): void;
  /** Cross-fades to an expression of the model on stage, or with null back to none. */
  setExpression(name: string | null): void;
  /** Plays motion `index` of the motion group `group` once. */
  playMotion(group: string, index: number): void;
  /** Plays a parameter preset, replacing any playing one. */
  playPreset(name: PresetName): void;
  /** Fades out the playing preset, e.g. ends a doze. */
  stopPreset(): void;
  dispose(): void;
}

interface OnStage extends LoadedModel {
  source: ModelSource;
  framing: Framing;
  defaultFraming: Framing;
  /** The visible model's extent; framing keeps the window's centre inside it. */
  extent: Bounds | undefined;
  /** Where the gaze is measured from. */
  face: ModelPoint | undefined;
  parameters: ModelParameters;
  life: Life;
}

// High-refresh monitors would otherwise drive the loop at 144 Hz for no visible gain.
const MAX_FPS = 60;
// Idle motion, breathing, sway and an easing gaze look the same at half the rate. Full rate
// is kept while the cursor is over the window (the hit test reads back drawn frames) or a
// preset plays.
const IDLE_FPS = 30;
// Slightly under the frame time, so vsync jitter does not skip a frame.
const MIN_FRAME_MS = 1000 / MAX_FPS - 1;
const IDLE_MIN_FRAME_MS = 1000 / IDLE_FPS - 1;
// Caps the physics step after a stall so hair does not fly off.
const MAX_DELTA_SECONDS = 0.1;
// Premultiplied alpha (0-255) from which a pixel counts as part of the model; anti-aliased
// edges and wispy hair below it let clicks through.
const HIT_ALPHA = 24;
// A still cursor is re-tested this often, since the model moves under it.
const REPROBE_MS = 200;

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function getContext(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: true,
    preserveDrawingBuffer: false,
  });
  if (!gl) {
    throw new Error("WebGL 2 is not available");
  }
  return gl;
}

export function createStage(canvas: HTMLCanvasElement): Stage {
  const gl = getContext(canvas);

  const projection = new CubismMatrix44();
  const pixel = new Uint8Array(4);
  const hitListeners = new Set<(hit: boolean) => void>();
  let current: OnStage | undefined;
  let source: ModelSource | undefined;
  // What the last load asked for, kept up to date so a context-loss reload looks the same.
  let requestedFraming: Framing | undefined;
  let pointer: Point | null = null;
  let cursor: Point | null = null;
  let cursorMovedAt = -Infinity;
  let probeDue = false;
  let lastProbe = 0;
  let hit = false;
  let pending: AbortController | undefined;
  let frame: number | undefined;
  let lastFrame: number | undefined;
  let contextLost = false;
  let disposed = false;

  function drawFrame(now: number) {
    frame = requestAnimationFrame(drawFrame);
    if (!current) {
      return;
    }
    const minFrameMs =
      pointer !== null || current.life.presets.playing ? MIN_FRAME_MS : IDLE_MIN_FRAME_MS;
    if (lastFrame !== undefined && now - lastFrame < minFrameMs) {
      return;
    }
    const delta =
      lastFrame === undefined ? 0 : Math.min((now - lastFrame) / 1000, MAX_DELTA_SECONDS);
    lastFrame = now;
    render(current, delta);

    if (pointer && (probeDue || now - lastProbe >= REPROBE_MS)) {
      probe(pointer, now);
    }
  }

  function render(onStage: OnStage, delta: number) {
    const { width, height } = canvas;
    if (width === 0 || height === 0) {
      return;
    }
    const { zoom, centerX, centerY } = onStage.framing;
    const scaleX = (zoom * height) / width;
    projection.loadIdentity();
    projection.scale(scaleX, zoom);
    projection.translate(-centerX * scaleX, -centerY * zoom);

    const { model, life, parameters } = onStage;
    model.updateMotion(delta, life.presets.playing);
    life.update(
      delta,
      {
        cursor: gazeAt(onStage),
        cursorStillFor: (performance.now() - cursorMovedAt) / 1000,
        motionBlinks: model.motionBlinks,
      },
      parameters,
    );
    model.update(delta);

    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    model.draw(projection, [0, 0, width, height]);
  }

  /** The gaze towards the cursor from the model's face as currently framed. */
  function gazeAt({ face, framing }: OnStage): GazeVector | null {
    if (!cursor || !face) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.height === 0) {
      return null;
    }
    const at = modelToWindow(framing, rect.width / rect.height, face);
    return gazeTowards(
      cursor.x - (rect.left + at.x * rect.width),
      cursor.y - (rect.top + at.y * rect.height),
    );
  }

  /**
   * Reads the alpha under the pointer. The drawing buffer is not preserved, so this must run
   * in the frame that drew it.
   */
  function probe(point: Point, now: number) {
    probeDue = false;
    lastProbe = now;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((point.x - rect.left) * (canvas.width / rect.width));
    const y = Math.floor((point.y - rect.top) * (canvas.height / rect.height));
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) {
      setHit(false);
      return;
    }
    // WebGL rows run bottom-up.
    gl.readPixels(x, canvas.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    setHit((pixel[3] ?? 0) >= HIT_ALPHA);
  }

  function setHit(next: boolean) {
    if (next === hit) return;
    hit = next;
    for (const listener of hitListeners) {
      listener(hit);
    }
  }

  /** Runs the loop only while there is something visible to draw. */
  function syncLoop() {
    const shouldRun = !disposed && !contextLost && current !== undefined && !document.hidden;
    if (shouldRun && frame === undefined) {
      lastFrame = undefined;
      frame = requestAnimationFrame(drawFrame);
    } else if (!shouldRun && frame !== undefined) {
      cancelAnimationFrame(frame);
      frame = undefined;
    }
  }

  function unloadModel() {
    current?.model.release();
    current = undefined;
    setHit(false);
    syncLoop();
  }

  const resizeObserver = new ResizeObserver(([entry]) => {
    if (!entry) return;
    const device = entry.devicePixelContentBoxSize?.[0];
    canvas.width = device
      ? device.inlineSize
      : Math.round(entry.contentRect.width * devicePixelRatio);
    canvas.height = device
      ? device.blockSize
      : Math.round(entry.contentRect.height * devicePixelRatio);
    // Resizing clears the canvas; redraw before this paint instead of showing a blank frame
    // until the next animation frame, which flickers while the window is being scaled.
    if (current && frame !== undefined) {
      render(current, 0);
    }
  });
  // The device-pixel box also changes when the window moves to a monitor with another scale.
  resizeObserver.observe(canvas, { box: "device-pixel-content-box" });

  function onContextLost(event: Event) {
    // Allows the browser to restore the context; everything on the GPU is gone until then.
    event.preventDefault();
    contextLost = true;
    pending?.abort();
    requestedFraming = current?.framing ?? requestedFraming;
    unloadModel();
    CubismRenderer_WebGL.doStaticRelease();
  }

  function onContextRestored() {
    contextLost = false;
    if (source) {
      stage.load(source, requestedFraming).catch((error: unknown) => {
        if (!isAbortError(error)) console.error("failed to reload model after context loss", error);
      });
    }
  }

  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);
  document.addEventListener("visibilitychange", syncLoop);

  const stage: Stage = {
    get manifest() {
      return current?.manifest;
    },

    get source() {
      return current?.source;
    },

    get framing() {
      return current?.framing;
    },

    zoomFraming(factor, anchorY) {
      if (!current) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.height === 0) return;
      current.framing = zoomFraming(
        current.framing,
        factor,
        (anchorY - rect.top) / rect.height,
        current.extent,
      );
      probeDue = true;
    },

    panFraming(dx, dy) {
      if (!current) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.height === 0) return;
      current.framing = panFraming(
        current.framing,
        dx / rect.height,
        dy / rect.height,
        current.extent,
      );
      probeDue = true;
    },

    resetFraming() {
      if (!current) return;
      current.framing = current.defaultFraming;
      probeDue = true;
    },

    setFraming(framing) {
      if (!current) return;
      current.framing = clampFraming(framing, current.extent);
      probeDue = true;
    },

    setPointer(point) {
      pointer = point;
      probeDue = point !== null;
      // Without a running loop nothing is drawn, so nothing can be hit.
      if (!point || frame === undefined) {
        setHit(false);
      }
    },

    onHitChange(listener) {
      hitListeners.add(listener);
      return () => hitListeners.delete(listener);
    },

    setCursor(point) {
      cursor = point;
      cursorMovedAt = performance.now();
    },

    setExpression(name) {
      current?.model.setExpression(name);
    },

    playMotion(group, index) {
      current?.model.playMotion(group, index);
    },

    playPreset(name) {
      current?.life.presets.play(name);
    },

    stopPreset() {
      current?.life.presets.stop();
    },

    async load(next, framing) {
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      source = next;
      requestedFraming = framing;

      await startCubism();
      controller.signal.throwIfAborted();
      const loaded = await Live2DModel.load(gl, next, controller.signal);
      if (controller.signal.aborted) {
        loaded.model.release();
        controller.signal.throwIfAborted();
      }
      pending = undefined;
      current?.model.release();
      // Vertex positions are only valid once the model has been updated.
      loaded.model.update(0);
      const { model, manifest } = loaded;
      const drawables = model.drawableBounds();
      const extent = unionOf(drawables);
      const headArea = manifest.hitAreas.find((h) => /head|face/i.test(`${h.id} ${h.name}`));
      const fallback = clampFraming(
        defaultFraming({ layout: model.layout, canvasAspect: model.aspectRatio, drawables }),
        extent,
      );
      current = {
        ...loaded,
        source: next,
        // A saved framing from before the clamp may sit off the model; pull it back.
        framing: framing ? clampFraming(framing, extent) : fallback,
        defaultFraming: fallback,
        extent,
        face: faceAnchor(drawables, headArea && model.drawableBoundsById(headArea.id)),
        parameters: new ModelParameters(model.getModel(), manifest),
        life: new Life(manifest),
      };
      syncLoop();
      return manifest;
    },

    dispose() {
      disposed = true;
      pending?.abort();
      unloadModel();
      CubismRenderer_WebGL.doStaticRelease();
      hitListeners.clear();
      resizeObserver.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      document.removeEventListener("visibilitychange", syncLoop);
    },
  };

  return stage;
}
