// Turns the global cursor and mouse input into click-through, window drag, scaling and
// framing. Plain TypeScript: it runs per cursor event, outside React.

import {
  type CursorPosition,
  clearFraming,
  onCursorMoved,
  onResetFraming,
  saveFraming,
  scaleCompanion,
  setClickThrough,
  startWindowDrag,
} from "@/ipc";
import type { Stage } from "@/live2d/stage";

/** Elements with this attribute catch clicks the way the model does. */
export const HIT_REGION_ATTRIBUTE = "data-hit-region";

// Movement before a press becomes a drag, so a plain click stays a click.
const DRAG_THRESHOLD_PX = 4;
// Per pixel of wheel delta: one 100 px notch scales by about 5%.
const WHEEL_SENSITIVITY = 0.0005;
const LINE_HEIGHT_PX = 40;
// Framing changes arrive per wheel notch; save once they settle.
const FRAMING_SAVE_DELAY_MS = 300;

interface Press {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  panning: boolean;
}

function warn(what: string) {
  return (error: unknown) => console.warn(`failed to ${what}`, error);
}

/** Starts handling input for the companion window. Returns a function that stops it. */
export function startInteraction(stage: Stage | null): () => void {
  let overHitRegion = false;
  let overModel = false;
  let press: Press | null = null;
  // The click-through state last sent to the core; undefined until the first report.
  let reported: boolean | undefined;
  let pendingScale = 1;
  let scaleFrame: number | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  function report() {
    // Mid-press the window stays interactive even if the cursor slips off the model.
    const clickThrough = !(overHitRegion || overModel || press);
    if (clickThrough === reported) return;
    reported = clickThrough;
    setClickThrough(clickThrough).catch((error: unknown) => {
      reported = undefined;
      warn("toggle click-through")(error);
    });
  }

  function onCursor({ x, y }: CursorPosition) {
    const inside = x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight;
    overHitRegion =
      inside && document.elementFromPoint(x, y)?.closest(`[${HIT_REGION_ATTRIBUTE}]`) != null;
    stage?.setPointer(inside ? { x, y } : null);
    report();
  }

  function onHitChange(hit: boolean) {
    overModel = hit;
    report();
  }

  function saveFramingNow() {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    const id = stage?.source?.id;
    const framing = stage?.framing;
    if (id !== undefined && framing) {
      saveFraming(id, framing).catch(warn("save framing"));
    }
  }

  function onReset() {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    stage?.resetFraming();
    const id = stage?.source?.id;
    if (id !== undefined) {
      clearFraming(id).catch(warn("clear the saved framing"));
    }
  }

  function scheduleFramingSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveFramingNow, FRAMING_SAVE_DELAY_MS);
  }

  function endPress() {
    if (!press) return;
    if (document.documentElement.hasPointerCapture(press.pointerId)) {
      document.documentElement.releasePointerCapture(press.pointerId);
    }
    press = null;
    report();
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0 || !(overHitRegion || overModel)) return;
    press = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      panning: false,
    };
    // Keeps moves coming while a framing pan leaves the model or the window.
    document.documentElement.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    if (!press) return;
    if (press.panning) {
      pan(press, event);
      return;
    }
    const distance = Math.hypot(event.clientX - press.startX, event.clientY - press.startY);
    if (distance < DRAG_THRESHOLD_PX) return;
    if (event.shiftKey && stage?.framing) {
      press.panning = true;
      pan(press, event);
    } else {
      // The OS takes over the drag and swallows the button release.
      endPress();
      startWindowDrag().catch(warn("start window drag"));
    }
  }

  function pan(active: Press, event: PointerEvent) {
    stage?.panFraming(event.clientX - active.lastX, event.clientY - active.lastY);
    active.lastX = event.clientX;
    active.lastY = event.clientY;
  }

  function onPointerUp() {
    if (press?.panning) {
      scheduleFramingSave();
    }
    endPress();
  }

  function flushScale() {
    scaleFrame = undefined;
    const factor = pendingScale;
    pendingScale = 1;
    scaleCompanion(factor).catch(warn("scale the companion"));
  }

  function onWheel(event: WheelEvent) {
    if (!event.ctrlKey) return;
    // Ctrl+wheel would otherwise zoom the page.
    event.preventDefault();
    // With Shift held, Chromium reports vertical wheel motion as horizontal.
    const delta =
      (event.deltaY || event.deltaX) *
      (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? LINE_HEIGHT_PX : 1);
    const factor = Math.exp(-delta * WHEEL_SENSITIVITY);
    if (event.shiftKey) {
      stage?.zoomFraming(factor, event.clientY);
      scheduleFramingSave();
    } else {
      // Coalesced per frame: each resize is a native window operation.
      pendingScale *= factor;
      scaleFrame ??= requestAnimationFrame(flushScale);
    }
  }

  const subscriptions = [onCursorMoved(onCursor), onResetFraming(onReset)];
  const stopHits = stage?.onHitChange(onHitChange);
  window.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("wheel", onWheel, { passive: false });

  return () => {
    for (const subscription of subscriptions) {
      subscription.then((stop) => stop()).catch(warn("unsubscribe from core events"));
    }
    stopHits?.();
    window.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    window.removeEventListener("wheel", onWheel);
    if (scaleFrame !== undefined) cancelAnimationFrame(scaleFrame);
    if (saveTimer !== undefined) saveFramingNow();
  };
}
