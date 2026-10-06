// Where the character looks. A moving cursor gets her attention now and then rather than
// all the time: she notices it, follows it for a spell, loses interest and looks around on
// her own, and may notice it again later. A cursor over the companion always has her
// attention. Once it has been still for a while she wanders, glancing back at it at times.
// Eyes, head and body each ease towards the target at their own pace, eyes first.

/** A direction from -1 to 1 on each axis, y pointing up. */
export interface GazeVector {
  x: number;
  y: number;
}

const AHEAD: GazeVector = { x: 0, y: 0 };

// Within this many CSS px of the face the cursor counts as straight ahead, so hovering
// over the face does not make the eyes jitter.
const DEAD_ZONE_PX = 24;
// Distance beyond the dead zone at which the gaze reaches ~70% of its range. Screen pixels,
// so the feel does not change with zoom or window scale.
const REACH_PX = 320;

// Seconds the cursor must be still before it stops counting as active, picked per stillness.
const STILL_SECONDS = [4, 8] as const;
// Chance that a cursor starting to move gets noticed at once.
const NOTICE_CHANCE = 0.35;
// Seconds a spell of following the moving cursor lasts, and of ignoring it in between.
const ATTEND_SECONDS = [1.5, 4] as const;
const IGNORE_SECONDS = [8, 20] as const;
// Seconds the gaze stays on the cursor after it leaves the companion.
const NEAR_LINGER_SECONDS = 1.5;
// Seconds the wandering gaze rests on each target.
const DWELL_SECONDS = [1.5, 4.5] as const;
// Chance that a new wander target is the cursor again, or straight ahead.
const GLANCE_BACK_CHANCE = 0.3;
const LOOK_AHEAD_CHANCE = 0.25;
const WANDER_X = 0.6;
const WANDER_Y_UP = 0.25;
const WANDER_Y_DOWN = 0.35;

// Easing time constants.
const EYES_TAU = 0.05;
const HEAD_TAU = 0.3;
const BODY_TAU = 0.7;

/** The gaze towards a cursor `dx`, `dy` CSS px right of and below the face. */
export function gazeTowards(dx: number, dy: number): GazeVector {
  const distance = Math.hypot(dx, dy);
  const beyond = distance - DEAD_ZONE_PX;
  if (beyond <= 0) {
    return { ...AHEAD };
  }
  const reach = beyond / Math.hypot(beyond, REACH_PX);
  return { x: (dx / distance) * reach, y: (-dy / distance) * reach };
}

function between(random: () => number, [min, max]: readonly [number, number]): number {
  return min + (max - min) * random();
}

function ease(current: GazeVector, target: GazeVector, deltaSeconds: number, tau: number) {
  const k = 1 - Math.exp(-deltaSeconds / tau);
  current.x += (target.x - current.x) * k;
  current.y += (target.y - current.y) * k;
}

export interface GazeInput {
  /** The gaze towards the cursor, or null while the cursor position is unknown. */
  cursor: GazeVector | null;
  /** Seconds since the cursor last moved. */
  cursorStillFor: number;
  /** The cursor is over the companion, which always holds her attention. */
  cursorNear: boolean;
}

export class Gaze {
  readonly eyes: GazeVector = { ...AHEAD };
  readonly head: GazeVector = { ...AHEAD };
  readonly body: GazeVector = { ...AHEAD };
  private target: GazeVector = { ...AHEAD };
  private wanderLeft = 0;
  private stillLimit: number;
  private lastStillFor = Infinity;
  // While the cursor is active: seconds left of following it, then of ignoring it.
  private attentionLeft = 0;
  private ignoreLeft = 0;

  constructor(private readonly random: () => number = Math.random) {
    this.stillLimit = between(random, STILL_SECONDS);
  }

  update(deltaSeconds: number, { cursor, cursorStillFor, cursorNear }: GazeInput): void {
    const wasActive = this.lastStillFor < this.stillLimit;
    if (cursorStillFor < this.lastStillFor) {
      // The cursor moved: it stays active until a fresh pause.
      this.stillLimit = between(this.random, STILL_SECONDS);
      if (!wasActive) this.notice();
    }
    this.lastStillFor = cursorStillFor;

    const active = cursor !== null && cursorStillFor < this.stillLimit;
    if (active && cursorNear) {
      this.attentionLeft = Math.max(this.attentionLeft, NEAR_LINGER_SECONDS);
    }
    if (active && this.attentionLeft > 0) {
      this.target = cursor;
      // Whenever she stops following, she picks somewhere new to look straight away.
      this.wanderLeft = 0;
      this.attentionLeft -= deltaSeconds;
      if (this.attentionLeft <= 0) {
        this.ignoreLeft = between(this.random, IGNORE_SECONDS);
      }
    } else {
      if (active) {
        this.ignoreLeft -= deltaSeconds;
        if (this.ignoreLeft <= 0) {
          this.attentionLeft = between(this.random, ATTEND_SECONDS);
        }
      } else {
        this.attentionLeft = 0;
      }
      // A glance back aims at where the cursor is when it is picked, which only means
      // something while the cursor is still; at a moving one she would stare at nothing.
      this.wander(deltaSeconds, active ? null : cursor);
    }

    ease(this.eyes, this.target, deltaSeconds, EYES_TAU);
    ease(this.head, this.target, deltaSeconds, HEAD_TAU);
    ease(this.body, this.target, deltaSeconds, BODY_TAU);
  }

  /** A cursor that starts moving catches her attention, or not for a while. */
  private notice(): void {
    if (this.random() < NOTICE_CHANCE) {
      this.attentionLeft = between(this.random, ATTEND_SECONDS);
    } else {
      this.attentionLeft = 0;
      this.ignoreLeft = between(this.random, IGNORE_SECONDS);
    }
  }

  private wander(deltaSeconds: number, cursor: GazeVector | null): void {
    this.wanderLeft -= deltaSeconds;
    if (this.wanderLeft <= 0) {
      this.target = this.wanderTarget(cursor);
      this.wanderLeft = between(this.random, DWELL_SECONDS);
    }
  }

  private wanderTarget(cursor: GazeVector | null): GazeVector {
    const roll = this.random();
    if (cursor && roll < GLANCE_BACK_CHANCE) {
      return cursor;
    }
    if (roll < GLANCE_BACK_CHANCE + LOOK_AHEAD_CHANCE) {
      return { ...AHEAD };
    }
    return {
      x: (this.random() * 2 - 1) * WANDER_X,
      y: -WANDER_Y_DOWN + this.random() * (WANDER_Y_UP + WANDER_Y_DOWN),
    };
  }
}
