import type { UnlistenFn } from "@tauri-apps/api/event";
import { commands, events, type Framing as WireFraming } from "./bindings";
import { unwrap } from "./result";

// Specta types every float as `number | null` because JSON has no NaN or Infinity. The core
// only sends finite numbers, so the wrappers below drop anything else.
type Finite<T> = { [K in keyof T]-?: Exclude<T[K], null | undefined> };

/** The cursor in CSS pixels relative to the companion window's client area. */
export type CursorPosition = { x: number; y: number };

export type Framing = Finite<WireFraming>;

/** Subscribes to the global cursor position, which the core polls for this window. */
export function onCursorMoved(handler: (position: CursorPosition) => void): Promise<UnlistenFn> {
  return events.cursorMoved.listen(({ payload: { x, y } }) => {
    if (x !== null && y !== null) {
      handler({ x, y });
    }
  });
}

/** Lets clicks pass through the companion window, or makes it interactive. */
export async function setClickThrough(enabled: boolean): Promise<void> {
  await unwrap(commands.setClickThrough(enabled));
}

/** Multiplies the companion window's size by `factor`; the core clamps the result. */
export async function scaleCompanion(factor: number): Promise<void> {
  await unwrap(commands.scaleCompanion(factor));
}

/** The framing the user saved for `character`, or null if they never adjusted it. */
export async function loadFraming(character: string): Promise<Framing | null> {
  const framing = await unwrap(commands.characterFraming(character));
  if (framing === null || framing.zoom === null || framing.centerY === null) {
    return null;
  }
  return { zoom: framing.zoom, centerX: framing.centerX ?? 0, centerY: framing.centerY };
}

export async function saveFraming(character: string, framing: Framing): Promise<void> {
  await unwrap(commands.saveCharacterFraming(character, framing));
}

/** Forgets the saved framing for `character`, so the model's default applies again. */
export async function clearFraming(character: string): Promise<void> {
  await unwrap(commands.clearCharacterFraming(character));
}

/** Whether the companion stays above other windows. */
export async function alwaysOnTop(): Promise<boolean> {
  return commands.alwaysOnTop();
}

export async function setAlwaysOnTop(enabled: boolean): Promise<void> {
  await commands.setAlwaysOnTop(enabled);
}

/** Subscribes to always-on-top changes, whether made from the tray or the companion menu. */
export function onAlwaysOnTopChanged(handler: (enabled: boolean) => void): Promise<UnlistenFn> {
  return events.alwaysOnTopChanged.listen(({ payload }) => handler(payload.alwaysOnTop));
}

/** Hides the companion to the tray. */
export async function hideCompanion(): Promise<void> {
  await commands.hideCompanion();
}

/** Subscribes to the user's request (tray menu) to reset the companion's framing. */
export function onResetFraming(handler: () => void): Promise<UnlistenFn> {
  return events.resetFraming.listen(() => handler());
}
