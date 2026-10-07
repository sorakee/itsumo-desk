import { describe, expect, it } from "vitest";
import {
  checkCustomName,
  cleanDescription,
  MAX_CUSTOM_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
} from "@/windows/settings/mappingRules";

describe("checkCustomName", () => {
  it("normalises what the user typed", () => {
    expect(checkCustomName("  Smug  Face ", [])).toEqual({ name: "smug_face" });
    expect(checkCustomName("half-lidded", [])).toEqual({ name: "half_lidded" });
    expect(checkCustomName("grin_2", [])).toEqual({ name: "grin_2" });
  });

  it("explains names it cannot take", () => {
    expect(checkCustomName(" ", []).error).toBeDefined();
    expect(checkCustomName("x".repeat(MAX_CUSTOM_NAME_LENGTH + 1), []).error).toBeDefined();
    expect(checkCustomName("x".repeat(MAX_CUSTOM_NAME_LENGTH), []).error).toBeUndefined();
    expect(checkCustomName("スマグ", []).error).toBeDefined();
    expect(checkCustomName("smug!", []).error).toBeDefined();
    expect(checkCustomName("Joy", []).error).toBeDefined();
    expect(checkCustomName("smug", ["smug"]).error).toBeDefined();
  });
});

describe("cleanDescription", () => {
  it("keeps one line with single spaces", () => {
    expect(cleanDescription("  half-lidded\n grin\t ")).toBe("half-lidded grin");
    expect(cleanDescription("bell\u0007")).toBe("bell");
  });

  it("cuts long text by characters, not UTF-16 units", () => {
    const long = "😀".repeat(MAX_DESCRIPTION_LENGTH + 5);
    expect(Array.from(cleanDescription(long))).toHaveLength(MAX_DESCRIPTION_LENGTH);
  });
});
