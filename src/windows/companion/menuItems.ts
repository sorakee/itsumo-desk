// The companion menu's items (D41), clockwise from the top. Items for features that are not
// built yet are left out rather than shown disabled.

import { hideCompanion, openSettings, setAlwaysOnTop } from "@/ipc";
import type { IconName } from "@/shared/icons";
import { useCompanionStore } from "@/stores/companion";

/** Button colours from the comic palette; see `CompanionMenu.module.css`. */
export type MenuTone = "coral" | "teal" | "orange" | "yellow";

export interface MenuItem {
  id: string;
  icon: IconName;
  label: string;
  tone: MenuTone;
  run: () => Promise<void>;
}

export function useMenuItems(): MenuItem[] {
  const alwaysOnTop = useCompanionStore((state) => state.alwaysOnTop);
  return [
    {
      id: "pin",
      icon: alwaysOnTop ? "pinOff" : "pin",
      label: alwaysOnTop ? "Unpin" : "Pin on top",
      tone: "coral",
      run: () => setAlwaysOnTop(!alwaysOnTop),
    },
    { id: "settings", icon: "settings", label: "Settings", tone: "teal", run: openSettings },
    { id: "hide", icon: "hide", label: "Hide", tone: "orange", run: hideCompanion },
  ];
}
