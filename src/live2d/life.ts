// Procedural life (layer 2) and parameter presets (layer 4), applied each frame on top of
// whatever the idle motion left. Everything writes through `ModelParameters`, so parameters
// the model lacks are skipped.

import { Gaze, type GazeInput } from "@/live2d/gaze";
import type { ModelManifest } from "@/live2d/manifest";
import type { ModelParameters } from "@/live2d/parameters";
import { PresetPlayer, type PresetTarget } from "@/live2d/presets";

// Blink timing in seconds.
const BLINK_INTERVAL = [2, 6] as const;
const DOUBLE_BLINK_CHANCE = 0.15;
const DOUBLE_BLINK_INTERVAL = [0.15, 0.3] as const;
const BLINK_CLOSING = 0.08;
const BLINK_CLOSED = 0.05;
const BLINK_OPENING = 0.15;

const BREATH_PERIOD = 3.4;

/** Slow idle drift: half-range amplitude and the periods of two summed sines. */
const SWAY = [
  { id: "ParamAngleX", amplitude: 0.12, periods: [6.5, 3.9] },
  { id: "ParamAngleY", amplitude: 0.08, periods: [5.3, 3.1] },
  { id: "ParamAngleZ", amplitude: 0.1, periods: [7.7, 4.3] },
  { id: "ParamBodyAngleX", amplitude: 0.12, periods: [9.1, 5.7] },
  { id: "ParamBodyAngleZ", amplitude: 0.1, periods: [11.3, 6.1] },
] as const;

// How far the gaze turns each part, in half-ranges (eyeballs are set directly).
const HEAD_TURN = 0.8;
// Looking diagonally tilts the head a little, as the Cubism samples do.
const HEAD_TILT = 0.6;
const BODY_TURN = 0.5;
// How much the eyeballs follow the gaze rather than the idle motion.
const EYE_WEIGHT = 0.9;

function between(random: () => number, [min, max]: readonly [number, number]): number {
  return min + (max - min) * random();
}

/** Auto-blink: how open the eyes are, from 1 (as posed) to 0 (shut). */
export class Blink {
  private elapsed = 0;
  private nextAt: number;

  constructor(private readonly random: () => number = Math.random) {
    this.nextAt = between(random, BLINK_INTERVAL);
  }

  update(deltaSeconds: number): number {
    this.elapsed += deltaSeconds;
    const t = this.elapsed - this.nextAt;
    if (t < 0) return 1;
    if (t < BLINK_CLOSING) return 1 - t / BLINK_CLOSING;
    if (t < BLINK_CLOSING + BLINK_CLOSED) return 0;
    const opening = t - BLINK_CLOSING - BLINK_CLOSED;
    if (opening < BLINK_OPENING) return opening / BLINK_OPENING;
    this.elapsed = 0;
    this.nextAt = between(
      this.random,
      this.random() < DOUBLE_BLINK_CHANCE ? DOUBLE_BLINK_INTERVAL : BLINK_INTERVAL,
    );
    return 1;
  }
}

export interface LifeInput extends GazeInput {
  /** The idle motion playing now blinks by itself; auto-blink would double it. */
  motionBlinks: boolean;
}

export class Life {
  readonly presets = new PresetPlayer();
  private readonly gaze: Gaze;
  private readonly blink: Blink;
  private readonly phases: number[];
  private time = 0;

  constructor(
    private readonly manifest: Pick<ModelManifest, "eyeBlinkIds" | "lipSyncIds">,
    random: () => number = Math.random,
  ) {
    this.gaze = new Gaze(random);
    this.blink = new Blink(random);
    // Random phases so two loads of a model do not sway in lockstep.
    this.phases = SWAY.flatMap(() => [random(), random()].map((r) => r * 2 * Math.PI));
  }

  /** Advances by `deltaSeconds` and writes this frame's layers 2 and 4 to `params`. */
  update(deltaSeconds: number, input: LifeInput, params: ModelParameters): void {
    this.time += deltaSeconds;
    this.gaze.update(deltaSeconds, input);
    const eyesOpen = this.blink.update(deltaSeconds);
    this.presets.update(deltaSeconds);

    const breath = 0.5 + 0.5 * Math.sin((2 * Math.PI * this.time) / BREATH_PERIOD);
    params.offset("ParamBreath", breath);

    SWAY.forEach(({ id, amplitude, periods: [slow, fast] }, i) => {
      const wave =
        0.7 * Math.sin((2 * Math.PI * this.time) / slow + (this.phases[2 * i] ?? 0)) +
        0.3 * Math.sin((2 * Math.PI * this.time) / fast + (this.phases[2 * i + 1] ?? 0));
      params.offset(id, amplitude * wave);
    });

    const { head, body, eyes } = this.gaze;
    params.offset("ParamAngleX", head.x * HEAD_TURN);
    params.offset("ParamAngleY", head.y * HEAD_TURN);
    params.offset("ParamAngleZ", -head.x * head.y * HEAD_TILT);
    params.offset("ParamBodyAngleX", body.x * BODY_TURN);
    params.set("ParamEyeBallX", eyes.x, EYE_WEIGHT);
    params.set("ParamEyeBallY", eyes.y, EYE_WEIGHT);

    if (!input.motionBlinks) {
      for (const id of this.manifest.eyeBlinkIds) {
        params.multiply(id, eyesOpen);
      }
    }

    this.presets.apply({
      resolve: (target) => this.resolve(target),
      offset: (id, amount) => params.offset(id, amount),
      set: (id, value, weight) => params.set(id, value, weight),
      multiply: (id, factor) => params.multiply(id, factor),
    });
  }

  private resolve(target: PresetTarget): readonly string[] {
    switch (target) {
      case "eyes":
        return this.manifest.eyeBlinkIds;
      case "mouth":
        return this.manifest.lipSyncIds;
      default:
        return [target];
    }
  }
}
