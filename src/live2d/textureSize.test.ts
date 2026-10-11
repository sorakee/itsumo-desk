import { describe, expect, it } from "vitest";
import { MAX_TEXTURE_SIDE, uploadSize } from "@/live2d/textureSize";

describe("uploadSize", () => {
  it("keeps textures within the cap", () => {
    expect(uploadSize(2048, 2048, 32768)).toBeUndefined();
    expect(uploadSize(MAX_TEXTURE_SIDE, MAX_TEXTURE_SIDE, 32768)).toBeUndefined();
  });

  it("caps each side on its own", () => {
    expect(uploadSize(8192, 8192, 32768)).toEqual({ width: 4096, height: 4096 });
    expect(uploadSize(8192, 16384, 32768)).toEqual({ width: 4096, height: 4096 });
    expect(uploadSize(2048, 8192, 32768)).toEqual({ width: 2048, height: 4096 });
  });

  it("respects a GPU limit below the cap", () => {
    expect(uploadSize(4096, 4096, 2048)).toEqual({ width: 2048, height: 2048 });
  });
});
