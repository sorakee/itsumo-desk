import { describe, expect, it } from "vitest";
import { BaseExpressions, parseExpression } from "@/live2d/baseExpressions";
import { ModelParameters } from "@/live2d/parameters";

describe("parseExpression", () => {
  it("reads parameters and blends, with Cubism's defaults", () => {
    expect(
      parseExpression({
        Type: "Live2D Expression",
        FadeInTime: 0.5,
        Parameters: [
          { Id: "Watermark", Value: -1 },
          { Id: "EyeOpen", Value: 0.5, Blend: "Multiply" },
          { Id: "Outfit", Value: 30, Blend: "Overwrite" },
          { Id: "Odd", Value: 1, Blend: "Screen" },
        ],
      }),
    ).toEqual({
      fadeIn: 0.5,
      fadeOut: 1,
      parameters: [
        { id: "Watermark", value: -1, blend: "add" },
        { id: "EyeOpen", value: 0.5, blend: "multiply" },
        { id: "Outfit", value: 30, blend: "overwrite" },
        { id: "Odd", value: 1, blend: "add" },
      ],
    });
  });

  it("drops what it cannot read", () => {
    expect(parseExpression(null)).toBeUndefined();
    expect(parseExpression({ Parameters: "x" })).toBeUndefined();
    expect(
      parseExpression({
        FadeInTime: -1,
        FadeOutTime: "slow",
        Parameters: [7, { Id: "A" }, { Id: 3, Value: 1 }, { Id: "B", Value: Number.NaN }],
      }),
    ).toEqual({ fadeIn: 1, fadeOut: 1, parameters: [] });
  });
});

const parameters = [
  { id: "Mask", min: 0, max: 30, default: 0 },
  { id: "EyeOpen", min: 0, max: 1, default: 1 },
  { id: "Outfit", min: 0, max: 30, default: 0 },
];

const files: Record<string, object> = {
  mask: { FadeInTime: 0.5, FadeOutTime: 0.5, Parameters: [{ Id: "Mask", Value: 30 }] },
  sleepy: {
    FadeInTime: 0,
    FadeOutTime: 0,
    Parameters: [{ Id: "EyeOpen", Value: 0.5, Blend: "Multiply" }],
  },
  outfit: {
    FadeInTime: 0,
    Parameters: [
      { Id: "Outfit", Value: 20, Blend: "Overwrite" },
      { Id: "Missing", Value: 1 },
    ],
  },
  broken: { Parameters: "x" },
};

function setup() {
  const values = parameters.map((p) => p.default);
  const model = {
    getParameterValueByIndex: (i: number) => values[i] ?? 0,
    setParameterValueByIndex(i: number, value: number, weight = 1) {
      const p = parameters[i];
      if (!p) return;
      const blended = (values[i] ?? 0) * (1 - weight) + value * weight;
      values[i] = Math.min(p.max, Math.max(p.min, blended));
    },
  };
  const params = new ModelParameters(model, { parameters });
  const fetched: string[] = [];
  const base = new BaseExpressions(async (name) => {
    fetched.push(name);
    const file = files[name];
    return file && new TextEncoder().encode(JSON.stringify(file)).buffer;
  });
  /** One frame from the default pose, like the model's update. */
  function frame(deltaSeconds: number) {
    parameters.forEach((p, i) => {
      values[i] = p.default;
    });
    base.update(deltaSeconds, params);
    return [...values];
  }
  return { base, frame, fetched };
}

describe("BaseExpressions", () => {
  it("applies several at once with their blends", async () => {
    const { base, frame } = setup();
    await base.set(["mask", "sleepy", "outfit", "unknown", "broken"], true);

    expect(frame(0)).toEqual([30, 0.5, 20]);
  });

  it("fades in and out over the file's fade times", async () => {
    const { base, frame } = setup();
    await base.set(["mask"]);
    const halfway = frame(0.25)[0] ?? 0;
    expect(halfway).toBeGreaterThan(0);
    expect(halfway).toBeLessThan(30);
    expect(frame(0.25)[0]).toBe(30);

    await base.set([]);
    expect(frame(0.25)[0]).toBeCloseTo(halfway);
    expect(frame(0.25)[0]).toBe(0);
    expect(frame(1)[0]).toBe(0);
  });

  it("switches at once when asked to", async () => {
    const { base, frame } = setup();
    await base.set(["mask"], true);
    expect(frame(0)[0]).toBe(30);
    await base.set([], true);
    expect(frame(0)[0]).toBe(0);
  });

  it("loads each file once", async () => {
    const { base, fetched } = setup();
    await base.set(["mask"]);
    await base.set([]);
    await base.set(["mask", "broken"]);
    await base.set(["broken"]);

    expect(fetched).toEqual(["mask", "broken"]);
  });

  it("lets a later call supersede one still loading", async () => {
    const { base, frame } = setup();
    const first = base.set(["mask"], true);
    await base.set(["outfit"], true);
    await first;

    expect(frame(0)).toEqual([0, 1, 20]);
  });
});
