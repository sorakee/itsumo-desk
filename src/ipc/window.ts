import { getCurrentWindow } from "@tauri-apps/api/window";

/** Moves the current window with the mouse until the button is released. */
export function startWindowDrag(): Promise<void> {
  return getCurrentWindow().startDragging();
}
