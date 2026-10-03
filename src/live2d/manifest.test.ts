import { describe, expect, it } from "vitest";
import { buildManifest, parseDisplayNames } from "@/live2d/manifest";
import type { ModelSettings } from "@/live2d/modelSettings";

const settings: ModelSettings = {
  moc: "a.moc3",
  textures: ["t.png"],
  expressions: [{ name: "smile", file: "smile.exp3.json" }],
  motionGroups: [{ name: "Idle", motions: [{ file: "m1.json" }, { file: "m2.json" }] }],
  hitAreas: [
    { id: "HitAreaHead", name: "Head" },
    { id: "HitAreaMissing", name: "Ghost" },
  ],
  groups: [],
};

describe("buildManifest", () => {
  it("combines settings with what the moc contains", () => {
    const manifest = buildManifest({
      settings,
      parameters: [
        { id: "ParamAngleX", min: -30, max: 30, default: 0 },
        { id: "ParamCustom", min: 0, max: 1, default: 0.5 },
        { id: "ParamEyeLOpen", min: 0, max: 1, default: 1 },
      ],
      drawableIds: new Set(["HitAreaHead", "ArtMesh1"]),
      displayNames: new Map([["ParamAngleX", "Angle X"]]),
    });

    expect(manifest).toEqual({
      parameters: [
        { id: "ParamAngleX", min: -30, max: 30, default: 0, name: "Angle X" },
        { id: "ParamCustom", min: 0, max: 1, default: 0.5 },
        { id: "ParamEyeLOpen", min: 0, max: 1, default: 1 },
      ],
      expressions: ["smile"],
      motionGroups: [{ name: "Idle", motions: ["m1.json", "m2.json"] }],
      hitAreas: [{ id: "HitAreaHead", name: "Head" }],
      standardParameters: ["ParamAngleX", "ParamEyeLOpen"],
    });
  });
});

describe("parseDisplayNames", () => {
  it("reads parameter names", () => {
    const names = parseDisplayNames({
      Version: 3,
      Parameters: [
        { Id: "ParamAngleX", GroupId: "Face", Name: "Angle X" },
        { Id: "ParamBlank", Name: " " },
        { Id: 5, Name: "Bad id" },
        "junk",
      ],
    });
    expect([...names]).toEqual([["ParamAngleX", "Angle X"]]);
  });

  it.each([null, "x", {}, { Parameters: "x" }])("tolerates %j", (json) => {
    expect(parseDisplayNames(json).size).toBe(0);
  });
});
