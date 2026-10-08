import { describe, expect, it } from "vitest";
import type { Mapping } from "@/ipc";
import { EMPTY_MAPPING } from "@/windows/settings/mappingSlots";
import { fillFromSuggestions } from "@/windows/settings/mappingSuggestions";

const suggested: Mapping = {
  ...EMPTY_MAPPING,
  slots: {
    angry: { expression: "生气脸" },
    shy: { expression: "害羞脸" },
    greet: { motion: "招手" },
  },
  parameters: { ParamAngleX: "Param72", ParamAngleY: "Param73" },
  baseExpressions: ["水印开关"],
};

describe("fillFromSuggestions", () => {
  it("fills empty slots and roles, never base expressions", () => {
    expect(fillFromSuggestions(EMPTY_MAPPING, suggested)).toEqual({
      ...suggested,
      baseExpressions: [],
    });
  });

  it("keeps what the user mapped", () => {
    const mapping: Mapping = {
      ...EMPTY_MAPPING,
      slots: { angry: { preset: "headTilt" }, joy: { expression: "害羞脸" } },
      parameters: { ParamAngleX: "ParamAngleX" },
    };
    expect(fillFromSuggestions(mapping, suggested)).toEqual({
      ...mapping,
      // shy's target already plays for joy, so it stays empty.
      slots: { ...mapping.slots, greet: { motion: "招手" } },
      parameters: { ParamAngleX: "ParamAngleX", ParamAngleY: "Param73" },
    });
  });

  it("is null when nothing would change", () => {
    const filled = fillFromSuggestions(EMPTY_MAPPING, suggested);
    expect(filled).not.toBeNull();
    if (filled) expect(fillFromSuggestions(filled, suggested)).toBeNull();
    expect(fillFromSuggestions(EMPTY_MAPPING, EMPTY_MAPPING)).toBeNull();
  });
});
