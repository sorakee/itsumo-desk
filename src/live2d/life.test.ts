import { describe, expect, it } from "vitest";
import { Blink, Life, type LifeInput } from "@/live2d/life";
import { ModelParameters } from "@/live2d/parameters";

describe("Blink", () => {
  it("stays open until the interval, then closes and reopens", () => {
    // Interval 2 + 0.5 * 4 = 4 s.
    const blink = new Blink(() => 0.5);
    const step = 0.01;
    const values: number[] = [];
    for (let t = 0; t < 4.5; t += step) values.push(blink.update(step));

    expect(values.slice(0, 395).every((v) => v === 1)).toBe(true);
    expect(Math.min(...values)).toBe(0);
    expect(values.at(-1)).toBe(1);
  });

  it("sometimes blinks twice in a row", () => {
    // 0.1 < 15%: the next interval is a double blink's 0.15 + 0.1 * 0.15 s.
    const blink = new Blink(() => 0.1);
    let closed = 0;
    let wasOpen = true;
    for (let t = 0; t < 3.5; t += 0.01) {
      const open = blink.update(0.01) > 0;
      if (wasOpen && !open) closed++;
      wasOpen = open;
    }
    expect(closed).toBeGreaterThanOrEqual(3);
  });
});

const parameters = [
  { id: "ParamAngleX", min: -30, max: 30, default: 0 },
  { id: "ParamEyeBallX", min: -1, max: 1, default: 0 },
  { id: "EyeL", min: 0, max: 1, default: 1 },
  { id: "ParamBreath", min: 0, max: 1, default: 0 },
];

function setup() {
  const values = parameters.map((p) => p.default);
  const model = {
    values,
    getParameterValueByIndex: (i: number) => values[i] ?? 0,
    setParameterValueByIndex(i: number, value: number, weight = 1) {
      const p = parameters[i];
      if (!p) return;
      const blended = (values[i] ?? 0) * (1 - weight) + value * weight;
      values[i] = Math.min(p.max, Math.max(p.min, blended));
    },
  };
  const params = new ModelParameters(model, { parameters });
  const life = new Life({ eyeBlinkIds: ["EyeL"], lipSyncIds: [] }, () => 0.5);
  /** Runs `seconds` of frames, resetting to the motion's pose each frame like the stage. */
  function run(seconds: number, input: LifeInput) {
    for (let t = 0; t < seconds; t += 0.01) {
      parameters.forEach((p, i) => {
        values[i] = p.default;
      });
      life.update(0.01, input, params);
    }
  }
  return { values, life, run };
}

const still: LifeInput = {
  cursor: null,
  cursorStillFor: Infinity,
  cursorNear: false,
  motionBlinks: false,
};

describe("Life", () => {
  it("turns the head and eyes towards the cursor", () => {
    const { values, run } = setup();
    // Over the companion, so the gaze follows it without waiting to notice it.
    run(2, { cursor: { x: 1, y: 0 }, cursorStillFor: 0, cursorNear: true, motionBlinks: false });

    // 0.8 of the half-range, give or take the sway.
    expect(values[0]).toBeGreaterThan(18);
    expect(values[1]).toBeGreaterThan(0.8);
  });

  it("breathes", () => {
    const { values, run } = setup();
    const breaths = new Set<number>();
    for (let i = 0; i < 40; i++) {
      run(0.1, still);
      breaths.add(Math.round((values[3] ?? 0) * 10));
    }
    expect(breaths.size).toBeGreaterThan(3);
  });

  it("blinks unless the idle motion does", () => {
    const own = setup();
    const motion = setup();
    let ownMin = 1;
    let motionMin = 1;
    for (let i = 0; i < 600; i++) {
      own.run(0.01, still);
      motion.run(0.01, { ...still, motionBlinks: true });
      ownMin = Math.min(ownMin, own.values[2] ?? 1);
      motionMin = Math.min(motionMin, motion.values[2] ?? 1);
    }
    expect(ownMin).toBe(0);
    expect(motionMin).toBe(1);
  });

  it("lets a preset override the gaze", () => {
    const { values, life, run } = setup();
    life.presets.play("lookAway");
    run(1, { cursor: { x: 1, y: 0 }, cursorStillFor: 0, cursorNear: false, motionBlinks: true });

    expect(values[1]).toBeCloseTo(-0.8);
  });
});
