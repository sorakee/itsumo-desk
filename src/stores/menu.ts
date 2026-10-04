import { create } from "zustand";

/** Where the companion menu was opened, in CSS pixels relative to the window. */
export interface MenuAnchor {
  x: number;
  y: number;
}

interface MenuState {
  /** Null while the menu is closed. */
  anchor: MenuAnchor | null;
  open: (anchor: MenuAnchor) => void;
  close: () => void;
}

export const useMenuStore = create<MenuState>()((set) => ({
  anchor: null,
  open: (anchor) => set({ anchor }),
  close: () => set({ anchor: null }),
}));
