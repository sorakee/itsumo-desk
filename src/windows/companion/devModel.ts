import type { ModelSource } from "@/live2d/model";

const DEFAULT_DEV_MODEL = "hiyori_pro/runtime/hiyori_pro_t11.model3.json";

/**
 * In dev, the Vite server exposes the gitignored `models/` folder, so a sample model shows
 * while no character is active. Production builds have no fallback.
 */
export function devModelSource(): ModelSource | null {
  if (!import.meta.env.DEV) {
    return null;
  }
  const path = import.meta.env.VITE_DEV_MODEL ?? DEFAULT_DEV_MODEL;
  return { id: `dev:${path}`, url: new URL(`/models/${path}`, window.location.href).href };
}
