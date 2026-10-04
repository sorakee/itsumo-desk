import { describe, expect, it } from "vitest";
import { ModelParameters, type ParameterAccess } from "@/live2d/parameters";

const parameters = [
  { id: "ParamAngleX", min: -30, max: 30, default: 0 },
  { id: "ParamEyeLOpen", min: 0, max: 1, default: 1 },
  { id: "ParamFlat", min: 0, max: 0, default: 0 },
];

/** Behaves like the Core: values clamp to the range, weights blend. */
function fakeModel(): ParameterAccess & { values: number[] } {
  const values = parameters.map((p) => p.default);
  return {
    values,
    getParameterValueByIndex: (index) => values[index] ?? 0,
    setParameterValueByIndex(index, value, weight = 1) {
      const p = parameters[index];
      if (!p) return;
      const blended = (values[index] ?? 0) * (1 - weight) + value * weight;
      values[index] = Math.min(p.max, Math.max(p.min, blended));
    },
  };
}

describe("ModelParameters", () => {
  it("writes only parameters in the manifest", () => {
    const model = fakeModel();
    const params = new ModelParameters(model, { parameters });

    params.set("ParamMissing", 1);
    params.offset("ParamMissing", 1);
    params.multiply("ParamMissing", 0);

    expect(params.has("ParamMissing")).toBe(false);
    expect(params.get("ParamMissing")).toBeUndefined();
    expect(model.values).toEqual([0, 1, 0]);
  });

  it("skips parameters with an empty range", () => {
    expect(new ModelParameters(fakeModel(), { parameters }).has("ParamFlat")).toBe(false);
  });

  it("offsets in half-ranges", () => {
    const model = fakeModel();
    const params = new ModelParameters(model, { parameters });

    params.offset("ParamAngleX", 0.5);
    params.offset("ParamEyeLOpen", -0.5);

    expect(params.get("ParamAngleX")).toBe(15);
    expect(params.get("ParamEyeLOpen")).toBe(0.75);
  });

  it("blends towards a value by weight", () => {
    const model = fakeModel();
    const params = new ModelParameters(model, { parameters });

    params.set("ParamAngleX", 20, 0.25);
    expect(params.get("ParamAngleX")).toBe(5);
    params.set("ParamAngleX", -10);
    expect(params.get("ParamAngleX")).toBe(-10);
  });

  it("multiplies", () => {
    const model = fakeModel();
    const params = new ModelParameters(model, { parameters });

    params.multiply("ParamEyeLOpen", 0.25);

    expect(params.get("ParamEyeLOpen")).toBe(0.25);
  });
});
