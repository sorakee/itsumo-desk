import type { ModelSource } from "@/live2d/model";

const DEFAULT_DEV_MODEL = "hiyori_pro/runtime/hiyori_pro_t11.model3.json";

/**
 * In dev, the Vite server exposes the gitignored `models/` folder, so a sample model can be
 * shown before character packs exist. Production builds have no model source yet.
 */
export function devModelSource(): ModelSource | null {
  if (!import.meta.env.DEV) {
    return null;
  }
  const path = import.meta.env.VITE_DEV_MODEL ?? DEFAULT_DEV_MODEL;
  return { url: new URL(`/models/${path}`, window.location.href).href };
}
