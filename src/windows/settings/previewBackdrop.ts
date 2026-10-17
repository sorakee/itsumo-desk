import { useState } from "react";

/** Backgrounds for the mapping preview; a pale one can wash out a pale model. */
export const PREVIEW_BACKDROPS = ["light", "grey", "dark"] as const;

export type PreviewBackdrop = (typeof PREVIEW_BACKDROPS)[number];

const STORAGE_KEY = "itsumo-desk.previewBackdrop";

function isBackdrop(value: unknown): value is PreviewBackdrop {
  return PREVIEW_BACKDROPS.some((backdrop) => backdrop === value);
}

// A display preference of this window only, so it lives in the webview's storage rather than
// the core's config. Storage can be unavailable; the preview then starts light each time.
function load(): PreviewBackdrop {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isBackdrop(stored) ? stored : "light";
  } catch {
    return "light";
  }
}

function save(backdrop: PreviewBackdrop) {
  try {
    localStorage.setItem(STORAGE_KEY, backdrop);
  } catch {
    // Kept for this session only.
  }
}

/** The preview's backdrop, remembered across characters and visits. */
export function usePreviewBackdrop(): [PreviewBackdrop, (backdrop: PreviewBackdrop) => void] {
  const [backdrop, setBackdrop] = useState(load);
  return [
    backdrop,
    (next) => {
      setBackdrop(next);
      save(next);
    },
  ];
}
