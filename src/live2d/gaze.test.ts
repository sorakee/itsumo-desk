import { describe, expect, it } from "vitest";
import { Gaze, type GazeVector, gazeTowards } from "@/live2d/gaze";

describe("gazeTowards", () => {
  it("looks straight ahead within the dead zone", () => {
    expect(gazeTowards(10, -10)).toEqual({ x: 0, y: 0 });
  });

  it("points at the cursor with y up", () => {
    const gaze = gazeTowards(300, 0);
    expect(gaze.x).toBeGreaterThan(0.5);
    expect(gaze.y).toBeCloseTo(0);
    expect(gazeTowards(0, 300).y).toBeLessThan(-0.5);
  });

  it("saturates below 1 far away", () => {
    const { x, y } = gazeTowards(-5000, -5000);
    expect(Math.hypot(x, y)).toBeLessThan(1);
    expect(Math.hypot(x, y)).toBeGreaterThan(0.95);
    expect(x).toBeLessThan(0);
    expect(y).toBeGreaterThan(0);
  });
});

/** Cycles through fixed values so wander choices are repeatable. */
function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
}

function run(gaze: Gaze, seconds: number, cursor: GazeVector | null, stillFrom = 0) {
  const step = 1 / 60;
  for (let t = 0; t < seconds; t += step) {
    gaze.update(step, { cursor, cursorStillFor: Math.max(0, t - stillFrom) });
  }
}

describe("Gaze", () => {
  const cursor = { x: -0.5, y: -0.2 };

  it("follows a moving cursor, eyes faster than head, head faster than body", () => {
    const gaze = new Gaze(() => 0.5);
    gaze.update(0.1, { cursor, cursorStillFor: 0 });

    expect(gaze.eyes.x).toBeLessThan(gaze.head.x);
    expect(gaze.head.x).toBeLessThan(gaze.body.x);
    run(gaze, 5, cursor, 10);
    expect(gaze.body.x).toBeCloseTo(-0.5, 2);
    expect(gaze.eyes.y).toBeCloseTo(-0.2, 2);
  });

  it("wanders once the cursor has been still", () => {
    // Still for 4 + 0.9 * 4 = 7.6 s, then a random point: x = (0.9 * 2 - 1) * 0.6.
    const gaze = new Gaze(() => 0.9);
    run(gaze, 7, cursor);
    expect(gaze.eyes.x).toBeCloseTo(-0.5, 2);

    run(gaze, 1, cursor, -7);
    expect(gaze.eyes.x).toBeCloseTo(0.48, 1);
  });

  it("wanders without a cursor", () => {
    const gaze = new Gaze(sequence(0.9, 0.95, 0.9));
    gaze.update(1, { cursor: null, cursorStillFor: Infinity });
    // Roll 0.95 picks a random point: x = (0.9 * 2 - 1) * 0.6, y = -0.35 + 0.9 * 0.6.
    expect(gaze.eyes.x).toBeCloseTo(0.48, 2);
    expect(gaze.eyes.y).toBeCloseTo(0.19, 2);
  });

  it("returns to the cursor when it moves again", () => {
    const gaze = new Gaze(() => 0.9);
    gaze.update(1, { cursor: null, cursorStillFor: Infinity });
    run(gaze, 1, cursor);
    expect(gaze.eyes.x).toBeCloseTo(-0.5, 2);
  });
});
