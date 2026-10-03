// The stage owns a canvas, its WebGL context and the render loop. React talks to it only
// through this small imperative API and never re-renders per frame.

import { CubismMatrix44 } from "@cubism/framework/math/cubismmatrix44";
import { CubismRenderer_WebGL } from "@cubism/framework/rendering/cubismrenderer_webgl";
import { startCubism } from "@/live2d/cubism";
import type { ModelManifest } from "@/live2d/manifest";
import { Live2DModel, type LoadedModel, type ModelSource } from "@/live2d/model";

export interface Stage {
  /**
   * Replaces the current model and resolves with the new model's manifest. A load that is
   * superseded by another `load` or by `dispose` rejects with an `AbortError`.
   */
  load(source: ModelSource): Promise<ModelManifest>;
  /** The manifest of the model on stage, if any. */
  readonly manifest: ModelManifest | undefined;
  dispose(): void;
}

// High-refresh monitors would otherwise drive the loop at 144 Hz for no visible gain.
const MAX_FPS = 60;
const MIN_FRAME_MS = 1000 / MAX_FPS - 1;
// Caps the physics step after a stall so hair does not fly off.
const MAX_DELTA_SECONDS = 0.1;

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
  let current: LoadedModel | undefined;
  let source: ModelSource | undefined;
  let pending: AbortController | undefined;
  let frame: number | undefined;
  let lastFrame: number | undefined;
  let contextLost = false;
  let disposed = false;

  function drawFrame(now: number) {
    frame = requestAnimationFrame(drawFrame);
    if (!current || (lastFrame !== undefined && now - lastFrame < MIN_FRAME_MS)) {
      return;
    }
    const delta =
      lastFrame === undefined ? 0 : Math.min((now - lastFrame) / 1000, MAX_DELTA_SECONDS);
    lastFrame = now;

    const { width, height } = canvas;
    if (width === 0 || height === 0) {
      return;
    }
    // Fit the model canvas inside the view: full height unless that would overflow sideways.
    const scale = Math.min(1, width / height / current.model.aspectRatio);
    projection.loadIdentity();
    projection.scale((scale * height) / width, scale);

    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    current.model.update(delta);
    current.model.draw(projection, [0, 0, width, height]);
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
  });
  // The device-pixel box also changes when the window moves to a monitor with another scale.
  resizeObserver.observe(canvas, { box: "device-pixel-content-box" });

  function onContextLost(event: Event) {
    // Allows the browser to restore the context; everything on the GPU is gone until then.
    event.preventDefault();
    contextLost = true;
    pending?.abort();
    unloadModel();
    CubismRenderer_WebGL.doStaticRelease();
  }

  function onContextRestored() {
    contextLost = false;
    if (source) {
      stage.load(source).catch((error: unknown) => {
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

    async load(next) {
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      source = next;

      await startCubism();
      controller.signal.throwIfAborted();
      const loaded = await Live2DModel.load(gl, next, controller.signal);
      if (controller.signal.aborted) {
        loaded.model.release();
        controller.signal.throwIfAborted();
      }
      pending = undefined;
      current?.model.release();
      current = loaded;
      syncLoop();
      return loaded.manifest;
    },

    dispose() {
      disposed = true;
      pending?.abort();
      unloadModel();
      CubismRenderer_WebGL.doStaticRelease();
      resizeObserver.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      document.removeEventListener("visibilitychange", syncLoop);
    },
  };

  return stage;
}
