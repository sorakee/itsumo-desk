import type { CubismModel } from "@cubism/framework/model/cubismmodel";
import type { CubismMotion } from "@cubism/framework/motion/cubismmotion";
import { describe, expect, it } from "vitest";
import {
  type Clip,
  IdleLoop,
  idleGroup,
  type MotionPlayer,
  motionCloses,
} from "@/live2d/idleMotion";

describe("idleGroup", () => {
  it("finds the idle group in any case", () => {
    const idle = { name: "IDLE", motions: [{ file: "a.motion3.json" }] };
    expect(idleGroup([{ name: "Tap", motions: [] }, idle])).toBe(idle);
    expect(idleGroup([{ name: "Idle2", motions: [] }])).toBeUndefined();
  });
});

function curve(id: string, segments: number[], target = "Parameter") {
  return { Target: target, Id: id, Segments: segments };
}

describe("motionCloses", () => {
  const eyes = ["ParamEyeLOpen", "ParamEyeROpen"];

  it("detects a blink in linear, stepped and bezier segments", () => {
    // Linear 1 -> 0.
    expect(motionCloses({ Curves: [curve("ParamEyeLOpen", [0, 1, 0, 1, 0])] }, eyes)).toBe(true);
    // Bezier ending at 0.2 after a linear segment.
    const bezier = [0, 1, 0, 0.5, 1, 1, 0.6, 1, 0.7, 1, 0.8, 0.2];
    expect(motionCloses({ Curves: [curve("ParamEyeROpen", bezier)] }, eyes)).toBe(true);
    // Stepped to 0.
    expect(motionCloses({ Curves: [curve("ParamEyeLOpen", [0, 1, 2, 1, 0])] }, eyes)).toBe(true);
  });

  it("ignores bezier control points", () => {
    const bezier = [0, 1, 1, 0.3, 0, 0.6, 0, 1, 1];
    expect(motionCloses({ Curves: [curve("ParamEyeLOpen", bezier)] }, eyes)).toBe(false);
  });

  it("ignores eyes that stay open and other parameters", () => {
    expect(
      motionCloses(
        {
          Curves: [
            curve("ParamEyeLOpen", [0, 1, 0, 1, 0.8]),
            curve("ParamMouthOpenY", [0, 0, 0, 1, 0]),
            curve("EyeBlink", [0, 0, 0, 1, 0], "Model"),
          ],
        },
        eyes,
      ),
    ).toBe(false);
  });

  it("tolerates malformed input", () => {
    expect(motionCloses(null, eyes)).toBe(false);
    expect(motionCloses({ Curves: "x" }, eyes)).toBe(false);
    expect(motionCloses({ Curves: [null, curve("ParamEyeLOpen", [0])] }, eyes)).toBe(false);
    expect(motionCloses({ Curves: [curve("ParamEyeLOpen", [0, 1, 1, 0.5])] }, eyes)).toBe(false);
  });
});

/** Plays each motion for `length` seconds, honouring a triggered fade-out. */
function fakeManager(length: number) {
  let playing: { motion: CubismMotion; left: number } | undefined;
  const started: CubismMotion[] = [];
  const manager: MotionPlayer = {
    isFinished: () => playing === undefined,
    startMotionPriority(motion) {
      playing = { motion: motion as CubismMotion, left: length };
      started.push(motion as CubismMotion);
      return started.length;
    },
    getCubismMotionQueueEntry: () =>
      ({
        setFadeOut(seconds: number) {
          if (playing) playing.left = Math.min(playing.left, seconds);
        },
      }) as ReturnType<MotionPlayer["getCubismMotionQueueEntry"]>,
    updateMotion(_model, delta) {
      if (playing) {
        playing.left -= delta;
        if (playing.left <= 0) playing = undefined;
      }
      return playing !== undefined;
    },
    stopAllMotions() {
      playing = undefined;
    },
  };
  return { manager, started };
}

// The loop only hands the model to the manager.
const model = {} as CubismModel;

function clip(name: string, blinks = false): Clip {
  return { motion: { name } as unknown as CubismMotion, blinks };
}

function run(loop: IdleLoop, seconds: number, quiet = false) {
  for (let t = 0; t < seconds; t += 0.1) loop.update(model, 0.1, quiet);
}

describe("IdleLoop", () => {
  it("rests between clips and does not repeat one", () => {
    // Rests: first 2 + 0.5 * 4 = 4 s, then 10 + 0.5 * 15 = 17.5 s.
    const { manager, started } = fakeManager(5);
    const a = clip("a");
    const b = clip("b");
    const loop = new IdleLoop(manager, [a, b], () => 0.5);

    run(loop, 3.9);
    expect(started).toHaveLength(0);
    run(loop, 0.3);
    expect(started).toEqual([b.motion]);
    // Plays 5 s, rests 17.5 s.
    run(loop, 22);
    expect(started).toHaveLength(1);
    run(loop, 1);
    expect(started).toEqual([b.motion, a.motion]);
  });

  it("reports blinking only while a blinking clip plays", () => {
    const { manager } = fakeManager(5);
    const loop = new IdleLoop(manager, [clip("a", true)], () => 0);

    expect(loop.blinks).toBe(false);
    run(loop, 2.5);
    expect(loop.blinks).toBe(true);
    run(loop, 6);
    expect(loop.blinks).toBe(false);
  });

  it("fades the clip out while quiet and rests afterwards", () => {
    const { manager, started } = fakeManager(5);
    const loop = new IdleLoop(manager, [clip("a", true)], () => 0);
    run(loop, 2.5);
    expect(started).toHaveLength(1);

    loop.update(model, 0.1, true);
    expect(loop.blinks).toBe(false);
    run(loop, 20, true);
    expect(manager.isFinished()).toBe(true);
    expect(started).toHaveLength(1);

    // A full rest (10 s at random 0) follows the quiet spell.
    run(loop, 9.8);
    expect(started).toHaveLength(1);
    run(loop, 0.4);
    expect(started).toHaveLength(2);
  });

  it("does nothing without clips", () => {
    const { manager, started } = fakeManager(5);
    run(new IdleLoop(manager, [], () => 0), 60);
    expect(started).toHaveLength(0);
  });
});
