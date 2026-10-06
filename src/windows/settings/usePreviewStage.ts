// A Live2D stage on a canvas in the settings window, for previewing a character's
// expressions and motions. The model looks at the cursor while it is over the window and
// starts framed as the companion frames it; scrolling zooms and dragging pans, so motions
// that move the whole body can be seen. Neither is saved.

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { loadFraming } from "@/ipc";
import type { Framing } from "@/live2d/framing";
import type { ModelManifest } from "@/live2d/manifest";
import type { ModelSource } from "@/live2d/model";
import { createStage, isAbortError, type Stage } from "@/live2d/stage";
import { errorMessage } from "@/shared/errorMessage";

// Per pixel of wheel delta: one 100 px notch zooms by about 10%.
const WHEEL_SENSITIVITY = 0.001;
const LINE_HEIGHT_PX = 40;

export type PreviewStatus =
  | { kind: "loading" }
  | { kind: "ready"; stage: Stage; manifest: ModelManifest }
  | { kind: "error"; message: string };

export interface Preview {
  status: PreviewStatus;
  /** Goes back to the framing the preview started with. */
  resetView: () => void;
}

/** Lets the user zoom and pan the preview. Returns a function that stops it. */
function startViewControls(canvas: HTMLCanvasElement, stage: Stage): () => void {
  let drag: { pointerId: number; x: number; y: number } | null = null;

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    const delta =
      event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? LINE_HEIGHT_PX : 1);
    stage.zoomFraming(Math.exp(-delta * WHEEL_SENSITIVITY), event.clientY);
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function onPointerMove(event: PointerEvent) {
    if (drag?.pointerId !== event.pointerId) return;
    stage.panFraming(event.clientX - drag.x, event.clientY - drag.y);
    drag = { ...drag, x: event.clientX, y: event.clientY };
  }

  function onPointerUp(event: PointerEvent) {
    if (drag?.pointerId === event.pointerId) drag = null;
  }

  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  return () => {
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
  };
}

/** Loads `source` (memoise it) into a stage on `canvas`; undefined waits for one. */
export function usePreviewStage(
  canvas: RefObject<HTMLCanvasElement | null>,
  source: ModelSource | undefined,
): Preview {
  const [stage, setStage] = useState<Stage | null>(null);
  const [status, setStatus] = useState<PreviewStatus>({ kind: "loading" });
  const initialFraming = useRef<Framing | undefined>(undefined);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let created: Stage;
    try {
      created = createStage(element);
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
      return;
    }
    const follow = (event: PointerEvent) =>
      created.setCursor({ x: event.clientX, y: event.clientY });
    window.addEventListener("pointermove", follow);
    const stopViewControls = startViewControls(element, created);
    setStage(created);
    return () => {
      window.removeEventListener("pointermove", follow);
      stopViewControls();
      created.dispose();
      setStage(null);
    };
  }, [canvas]);

  useEffect(() => {
    if (!stage || !source) return;
    setStatus({ kind: "loading" });
    let cancelled = false;
    loadFraming(source.id)
      .catch((error: unknown) => {
        console.warn("failed to load the saved framing", error);
        return null;
      })
      .then((framing) => (cancelled ? undefined : stage.load(source, framing ?? undefined)))
      .then(
        (manifest) => {
          if (!manifest || cancelled) return;
          initialFraming.current = stage.framing;
          setStatus({ kind: "ready", stage, manifest });
        },
        (error: unknown) => {
          if (isAbortError(error) || cancelled) return;
          console.error("failed to load the preview model", error);
          setStatus({ kind: "error", message: errorMessage(error) });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [stage, source]);

  const resetView = useCallback(() => {
    if (stage && initialFraming.current) stage.setFraming(initialFraming.current);
  }, [stage]);

  return { status, resetView };
}
