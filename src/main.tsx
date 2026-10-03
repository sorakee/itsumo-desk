import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CompanionApp } from "@/windows/companion/CompanionApp";
import "@/shared/tokens.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("missing #root element in index.html");
}

createRoot(root).render(
  <StrictMode>
    <CompanionApp />
  </StrictMode>,
);
