import { describe, expect, it } from "vitest";
import {
  ModelSettingsError,
  parseModelSettings,
  safeRelativePath,
  withExtras,
} from "@/live2d/modelSettings";

function model(fileReferences: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    Version: 3,
    FileReferences: { Moc: "a.moc3", Textures: ["a.2048/texture_00.png"], ...fileReferences },
    ...extra,
  };
}

describe("safeRelativePath", () => {
  it("keeps plain relative paths", () => {
    expect(safeRelativePath("motion/idle 01.motion3.json")).toBe("motion/idle 01.motion3.json");
  });

  it("normalises backslashes and redundant segments", () => {
    expect(safeRelativePath(".\\tex\\\\texture_00.png")).toBe("tex/texture_00.png");
  });

  it.each([
    "../secret.json",
    "motion/../../x.json",
    "/etc/passwd",
    "C:/Windows/win.ini",
    "C:\\Windows\\win.ini",
    "\\\\server\\share\\x",
    "https://example.com/a.moc3",
    "file:///c:/a.moc3",
    "a\0b",
    "",
    "   ",
    ".",
    42,
    null,
  ])("rejects %j", (value) => {
    expect(safeRelativePath(value)).toBeUndefined();
  });
});

describe("parseModelSettings", () => {
  it("parses a complete model3.json", () => {
    const settings = parseModelSettings(
      model(
        {
          Physics: "a.physics3.json",
          Pose: "a.pose3.json",
          DisplayInfo: "a.cdi3.json",
          UserData: "a.userdata3.json",
          Expressions: [{ Name: "smile", File: "exp/smile.exp3.json" }],
          Motions: {
            Idle: [{ File: "motion/idle.motion3.json", FadeInTime: 0.5, FadeOutTime: 1 }],
            "": [{ File: "motion/extra.motion3.json", Sound: "sound/extra.wav" }],
          },
        },
        {
          HitAreas: [{ Id: "HitAreaHead", Name: "Head" }],
          Groups: [{ Target: "Parameter", Name: "EyeBlink", Ids: ["ParamEyeLOpen"] }],
        },
      ),
    );

    expect(settings).toEqual({
      moc: "a.moc3",
      textures: ["a.2048/texture_00.png"],
      physics: "a.physics3.json",
      pose: "a.pose3.json",
      displayInfo: "a.cdi3.json",
      userData: "a.userdata3.json",
      expressions: [{ name: "smile", file: "exp/smile.exp3.json" }],
      motionGroups: [
        {
          name: "Idle",
          motions: [{ file: "motion/idle.motion3.json", fadeInTime: 0.5, fadeOutTime: 1 }],
        },
        { name: "", motions: [{ file: "motion/extra.motion3.json", sound: "sound/extra.wav" }] },
      ],
      hitAreas: [{ id: "HitAreaHead", name: "Head" }],
      groups: [{ name: "EyeBlink", ids: ["ParamEyeLOpen"] }],
    });
  });

  it.each([
    ["not an object", "model"],
    ["no FileReferences", { Version: 3 }],
    ["no moc", { FileReferences: { Textures: ["t.png"] } }],
    ["escaping moc", model({ Moc: "../a.moc3" })],
    ["no textures", model({ Textures: [] })],
    ["one bad texture", model({ Textures: ["t0.png", "/t1.png"] })],
  ])("rejects %s", (_, json) => {
    expect(() => parseModelSettings(json)).toThrow(ModelSettingsError);
  });

  it("drops malformed optional entries", () => {
    const settings = parseModelSettings(
      model(
        {
          Physics: "../physics3.json",
          Pose: 7,
          Expressions: [
            { Name: "ok", File: "ok.exp3.json" },
            { Name: "ok", File: "duplicate.exp3.json" },
            { Name: "", File: "nameless.exp3.json" },
            { Name: "escape", File: "../x.exp3.json" },
            "junk",
          ],
          Motions: {
            Idle: [{ File: "idle.motion3.json", FadeInTime: "slow", Sound: "/abs.wav" }, {}],
            Broken: [{ File: "https://example.com/m.json" }],
            NotAList: { File: "m.json" },
          },
        },
        {
          HitAreas: [{ Id: "HitArea" }, { Name: "no id" }],
          Groups: [
            { Target: "Part", Name: "Parts", Ids: ["PartA"] },
            { Target: "Parameter", Name: "LipSync", Ids: ["ParamMouthOpenY", 3, ""] },
          ],
        },
      ),
    );

    expect(settings.physics).toBeUndefined();
    expect(settings.pose).toBeUndefined();
    expect(settings.expressions).toEqual([{ name: "ok", file: "ok.exp3.json" }]);
    expect(settings.motionGroups).toEqual([
      { name: "Idle", motions: [{ file: "idle.motion3.json" }] },
    ]);
    expect(settings.hitAreas).toEqual([{ id: "HitArea", name: "HitArea" }]);
    expect(settings.groups).toEqual([{ name: "LipSync", ids: ["ParamMouthOpenY"] }]);
  });

  it("reads Layout in either key spelling and ignores the rest", () => {
    const settings = parseModelSettings(
      model({}, { Layout: { Width: 2, center_y: 0.5, Top: "high", constructor: 1, X: 3 } }),
    );
    expect(settings.layout).toEqual({ width: 2, centerY: 0.5 });
  });

  it("treats a Layout with nothing usable as absent", () => {
    expect(parseModelSettings(model({}, { Layout: { Foo: 1 } })).layout).toBeUndefined();
    expect(parseModelSettings(model({}, { Layout: [1, 2] })).layout).toBeUndefined();
  });
});

describe("withExtras", () => {
  const base = parseModelSettings(
    model({
      Expressions: [{ Name: "smile", File: "smile.exp3.json" }],
      Motions: { Idle: [{ File: "idle.motion3.json" }] },
    }),
  );

  it("returns the settings unchanged without extras", () => {
    expect(withExtras(base, undefined)).toBe(base);
  });

  it("adds expressions and motion groups the model lacks", () => {
    const merged = withExtras(base, {
      expressions: [
        { name: "害羞脸", file: "害羞脸.exp3.json" },
        { name: "smile", file: "other.exp3.json" },
        { name: "escape", file: "../x.exp3.json" },
      ],
      motionGroups: [
        { name: "招手", motions: [{ file: "招手.motion3.json" }] },
        { name: "Idle", motions: [{ file: "idle.motion3.json" }, { file: "IDLE2.motion3.json" }] },
        { name: "Empty", motions: [{ file: "/abs.motion3.json" }] },
      ],
    });
    expect(merged.expressions).toEqual([
      { name: "smile", file: "smile.exp3.json" },
      { name: "害羞脸", file: "害羞脸.exp3.json" },
    ]);
    expect(merged.motionGroups).toEqual([
      { name: "Idle", motions: [{ file: "idle.motion3.json" }, { file: "IDLE2.motion3.json" }] },
      { name: "招手", motions: [{ file: "招手.motion3.json" }] },
    ]);
    // The parsed settings are not mutated.
    expect(base.motionGroups[0]?.motions).toHaveLength(1);
  });
});
