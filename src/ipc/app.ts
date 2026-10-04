import { commands } from "./bindings";

/** Opens the settings window, or focuses it if it is already open. */
export async function openSettings(): Promise<void> {
  await commands.openSettings();
}
