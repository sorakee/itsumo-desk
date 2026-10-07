// Life layer 1: the model's own idle motions, played now and then.

import { CubismFramework } from "@cubism/framework/live2dcubismframework";
import type { CubismModel } from "@cubism/framework/model/cubismmodel";
import { CubismMotion } from "@cubism/framework/motion/cubismmotion";
import type { CubismMotionManager } from "@cubism/framework/motion/cubismmotionmanager";
import type { ModelManifest } from "@/live2d/manifest";
import type { MotionEntry, MotionGroup } from "@/live2d/modelSettings";

// Below this a blink parameter counts as closing: a motion that gets there blinks itself.
const CLOSED_BELOW = 0.5;
// Idle motions must never displace a triggered motion once those exist.
const IDLE_PRIORITY = 1;
// Seconds of procedural life only between idle clips, so the model's own idle motions
// stay occasional; the first comes sooner.
const FIRST_REST_SECONDS = [2, 6] as const;
const REST_SECONDS = [10, 25] as const;
// How quickly a clip gives way to a preset.
const QUIET_FADE_SECONDS = 0.5;

function between(random: () => number, [min, max]: readonly [number, number]): number {
  return min + (max - min) * random();
}

/**
 * The group the idle loop plays: the one the mapping's `idle` slot names (`mapped`) if the
 * model has it, else the group named "Idle" in any case.
 */
export function idleGroup(groups: MotionGroup[], mapped?: string): MotionGroup | undefined {
  const named = mapped === undefined ? undefined : groups.find((g) => g.name === mapped);
  return named ?? groups.find((g) => g.name.toLowerCase() === "idle");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The values a motion3.json segment list passes through (control points excluded). */
function segmentValues(segments: unknown[]): number[] {
  const values: number[] = [];
  const first = segments[1];
  if (typeof first !== "number") return values;
  values.push(first);
  let i = 2;
  while (i < segments.length) {
    // Bezier segments carry two control points before the end point; the others only it.
    const length = segments[i] === 1 ? 6 : 2;
    const value = segments[i + length];
    if (typeof value !== "number") break;
    values.push(value);
    i += length + 1;
  }
  return values;
}

/** Whether a motion3.json closes any of `ids`, i.e. blinks by itself. */
export function motionCloses(json: unknown, ids: readonly string[]): boolean {
  if (!isObject(json) || !Array.isArray(json.Curves)) return false;
  return json.Curves.some(
    (curve) =>
      isObject(curve) &&
      curve.Target === "Parameter" &&
      typeof curve.Id === "string" &&
      ids.includes(curve.Id) &&
      Array.isArray(curve.Segments) &&
      segmentValues(curve.Segments).some((v) => v < CLOSED_BELOW),
  );
}

export interface Clip {
  motion: CubismMotion;
  blinks: boolean;
}

/** Parses one motion; a malformed file is skipped with a warning. */
export function createClip(
  bytes: ArrayBuffer,
  entry: MotionEntry,
  manifest: Pick<ModelManifest, "eyeBlinkIds" | "lipSyncIds">,
): Clip | undefined {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    console.warn(`skipping motion ${entry.file}: not JSON`);
    return undefined;
  }
  let motion: CubismMotion | null = null;
  try {
    // The consistency check guards the Framework against malformed third-party files.
    motion = CubismMotion.create(bytes, bytes.byteLength, undefined, undefined, true);
  } catch {
    // Reported below.
  }
  if (!motion) {
    console.warn(`skipping motion ${entry.file}: not a valid motion3.json`);
    return undefined;
  }
  const ids = CubismFramework.getIdManager();
  motion.setEffectIds(
    manifest.eyeBlinkIds.map((id) => ids.getId(id)),
    manifest.lipSyncIds.map((id) => ids.getId(id)),
  );
  if (entry.fadeInTime !== undefined && entry.fadeInTime >= 0) {
    motion.setFadeInTime(entry.fadeInTime);
  }
  if (entry.fadeOutTime !== undefined && entry.fadeOutTime >= 0) {
    motion.setFadeOutTime(entry.fadeOutTime);
  }
  return { motion, blinks: motionCloses(json, manifest.eyeBlinkIds) };
}

/** The parts of the Framework's motion manager the idle loop drives. */
export type MotionPlayer = Pick<
  CubismMotionManager,
  | "isFinished"
  | "startMotionPriority"
  | "getCubismMotionQueueEntry"
  | "updateMotion"
  | "stopAllMotions"
>;

/**
 * Plays an idle clip now and then, with rests in between, never the same clip twice in a
 * row. While the stage is quiet (a preset is playing) the clip fades out and none starts;
 * the next one waits for a fresh rest. The clips belong to the model, which releases them.
 */
export class IdleLoop {
  private current: Clip | undefined;
  private last: Clip | undefined;
  private handle: number | undefined;
  private fadingOut = false;
  private restLeft: number;
  private restPending = false;

  constructor(
    private readonly manager: MotionPlayer,
    private clips: Clip[],
    private readonly random: () => number = Math.random,
  ) {
    this.restLeft = between(random, FIRST_REST_SECONDS);
  }

  /** Whether the motion playing now blinks by itself. */
  get blinks(): boolean {
    return !this.fadingOut && (this.current?.blinks ?? false);
  }

  update(model: CubismModel, deltaSeconds: number, quiet: boolean): void {
    if (this.current && this.manager.isFinished()) {
      this.current = undefined;
      this.fadingOut = false;
      this.restPending = true;
    }
    if (quiet) {
      this.restPending = true;
      if (this.current && !this.fadingOut && this.handle !== undefined) {
        this.manager.getCubismMotionQueueEntry(this.handle)?.setFadeOut(QUIET_FADE_SECONDS);
        this.fadingOut = true;
      }
    } else if (!this.current) {
      if (this.restPending) {
        this.restLeft = between(this.random, REST_SECONDS);
        this.restPending = false;
      }
      this.restLeft -= deltaSeconds;
      if (this.restLeft <= 0) {
        this.start();
      }
    }
    this.manager.updateMotion(model, deltaSeconds);
  }

  /** Plays from `clips` from now on; a clip that is playing finishes first. */
  setClips(clips: Clip[]): void {
    this.clips = clips;
  }

  release(): void {
    this.manager.stopAllMotions();
    this.clips = [];
    this.current = undefined;
    this.last = undefined;
  }

  private start(): void {
    const others = this.clips.filter((c) => c !== this.last);
    const pool = others.length > 0 ? others : this.clips;
    const clip = pool[Math.floor(this.random() * pool.length)];
    if (!clip) return;
    this.current = clip;
    this.last = clip;
    this.handle = this.manager.startMotionPriority(clip.motion, false, IDLE_PRIORITY);
  }
}
