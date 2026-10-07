import { describe, expect, it } from "vitest";
import {
  BEHAVIOUR_SLOTS,
  EMOTION_SLOTS,
  groupLabel,
  parseTargetKey,
  targetKey,
  targetParts,
} from "@/windows/settings/mappingSlots";

describe("mapping slots", () => {
  it("lists each of the core's 15 slots once", () => {
    const ids = [...BEHAVIOUR_SLOTS, ...EMOTION_SLOTS].map((s) => s.id);
    expect(ids).toHaveLength(15);
    expect(new Set(ids).size).toBe(15);
  });

  it("splits each kind of target", () => {
    expect(targetParts({ expression: "exp_03" })).toEqual({ kind: "expression", name: "exp_03" });
    expect(targetParts({ motion: "" })).toEqual({ kind: "motion", name: "" });
    expect(targetParts({ preset: "yawn" })).toEqual({ kind: "preset", name: "yawn" });
  });

  it("names the unnamed motion group", () => {
    expect(groupLabel("")).toBe("(unnamed)");
    expect(groupLabel("Tap")).toBe("Tap");
  });

  it("round-trips targets through their keys", () => {
    for (const target of [{ expression: "a:b" }, { motion: "" }, { preset: "doze" }]) {
      expect(parseTargetKey(targetKey(target))).toEqual(target);
    }
    expect(targetKey(undefined)).toBe("");
    expect(parseTargetKey("")).toBeUndefined();
  });
});
