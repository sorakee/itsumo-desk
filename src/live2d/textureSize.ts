// How big a model texture is uploaded (D51). Some models ship 8192² textures, a quarter of
// a GB of video memory each, for a window that is at most ~1300 px tall.

/** Longest side a texture is uploaded at. Mirrored by `MAX_TEXTURE_SIDE` in `character/weight.rs`. */
export const MAX_TEXTURE_SIDE = 4096;

export interface TextureSize {
  width: number;
  height: number;
}

/**
 * The size to upload a `width` × `height` texture at, or `undefined` when it fits as it is.
 * Each side is capped on its own: UVs are normalised, so the aspect ratio need not survive,
 * and an 8192×16384 atlas keeps twice the detail it would at 2048×4096.
 */
export function uploadSize(
  width: number,
  height: number,
  gpuLimit: number,
): TextureSize | undefined {
  const cap = Math.min(MAX_TEXTURE_SIDE, gpuLimit);
  if (width <= cap && height <= cap) {
    return undefined;
  }
  return { width: Math.min(width, cap), height: Math.min(height, cap) };
}
