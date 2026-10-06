import { describe, expect, it } from "vitest";
import {
  BEHAVIOUR_SLOTS,
  describeTarget,
  EMOTION_SLOTS,
  groupLabel,
} from "@/windows/settings/mappingSlots";

describe("mapping slots", () => {
  it("lists each of the core's 15 slots once", () => {
    const ids = [...BEHAVIOUR_SLOTS, ...EMOTION_SLOTS].map((s) => s.id);
    expect(ids).toHaveLength(15);
    expect(new Set(ids).size).toBe(15);
  });

  it("describes each kind of target", () => {
    expect(describeTarget({ expression: "exp_03" })).toEqual({
      kind: "Expression",
      name: "exp_03",
    });
    expect(describeTarget({ motion: "Idle" })).toEqual({ kind: "Motion", name: "Idle" });
    expect(describeTarget({ preset: "yawn" })).toEqual({ kind: "Preset", name: "yawn" });
  });

  it("names the unnamed motion group", () => {
    expect(groupLabel("")).toBe("(unnamed)");
    expect(describeTarget({ motion: "" }).name).toBe("(unnamed)");
    expect(groupLabel("Tap")).toBe("Tap");
  });
});
