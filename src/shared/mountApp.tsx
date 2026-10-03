import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/shared/tokens.css";

/** Renders a window's root component into the page's `#root` element. */
export function mountApp(app: ReactNode) {
  const root = document.getElementById("root");
  if (!root) {
    throw new Error("missing #root element in the window's HTML entry");
  }
  createRoot(root).render(<StrictMode>{app}</StrictMode>);
}
