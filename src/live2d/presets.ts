// Parameter presets: short keyframed animations over standard parameters that every model
// can play, whatever motions it ships. A track whose parameter the model lacks does nothing.

import type { StandardParameter } from "@/live2d/manifest";

/** `eyes` and `mouth` stand for the model's blink and lip-sync parameters. */
export type PresetTarget = StandardParameter | "eyes" | "mouth";

/**
 * How a track's value applies: `offset` adds half-ranges (see `ModelParameters.offset`),
 * `set` replaces the value, `scale` multiplies it.
 */
type Mode = "offset" | "set" | "scale";

type Key = readonly [seconds: number, value: number];

interface Track {
  target: PresetTarget;
  mode: Mode;
  /** Sorted by time. Values hold before the first key and after the last. */
  keys: readonly Key[];
}

interface Preset {
  duration: number;
  /** A looping preset plays from here to `duration` again until stopped. */
  loopFrom?: number;
  /** Envelope applied to every track, so `set` tracks hand back smoothly. */
  fadeIn: number;
  fadeOut: number;
  tracks: readonly Track[];
}

export const PRESET_NAMES = ["yawn", "nod", "headTilt", "lookAway", "doze"] as const;

export type PresetName = (typeof PRESET_NAMES)[number];

const PRESETS: Record<PresetName, Preset> = {
  yawn: {
    duration: 3.4,
    fadeIn: 0.3,
    fadeOut: 0.5,
    tracks: [
      {
        target: "mouth",
        mode: "set",
        keys: [
          [0, 0],
          [0.5, 0.5],
          [1, 1],
          [2.3, 1],
          [3, 0.2],
          [3.4, 0],
        ],
      },
      {
        target: "eyes",
        mode: "scale",
        keys: [
          [0, 1],
          [0.6, 0.5],
          [1.1, 0.1],
          [2.4, 0.15],
          [3, 0.8],
          [3.4, 1],
        ],
      },
      { target: "ParamAngleY", mode: "offset", keys: hold(0.35, 1, 2.3, 3.4) },
      { target: "ParamAngleZ", mode: "offset", keys: hold(0.15, 1, 2.3, 3.4) },
      { target: "ParamBodyAngleY", mode: "offset", keys: hold(0.25, 1, 2.3, 3.4) },
    ],
  },
  nod: {
    duration: 1.1,
    fadeIn: 0.05,
    fadeOut: 0.05,
    tracks: [
      {
        target: "ParamAngleY",
        mode: "offset",
        keys: [
          [0, 0],
          [0.25, -0.45],
          [0.5, 0.05],
          [0.75, -0.3],
          [1.1, 0],
        ],
      },
      { target: "ParamBodyAngleY", mode: "offset", keys: hold(-0.1, 0.3, 0.8, 1.1) },
    ],
  },
  headTilt: {
    duration: 3,
    fadeIn: 0.1,
    fadeOut: 0.1,
    tracks: [
      { target: "ParamAngleZ", mode: "offset", keys: hold(0.5, 0.5, 2.4, 3) },
      { target: "ParamAngleX", mode: "offset", keys: hold(0.12, 0.5, 2.4, 3) },
      { target: "ParamBodyAngleZ", mode: "offset", keys: hold(0.2, 0.6, 2.4, 3) },
    ],
  },
  lookAway: {
    duration: 3.2,
    // The eyes get there first; the head follows through its own keys.
    fadeIn: 0.15,
    fadeOut: 0.4,
    tracks: [
      { target: "ParamEyeBallX", mode: "set", keys: [[0, -0.8]] },
      { target: "ParamEyeBallY", mode: "set", keys: [[0, -0.2]] },
      { target: "ParamAngleX", mode: "offset", keys: hold(-0.45, 0.6, 2.6, 3.2) },
      { target: "ParamAngleY", mode: "offset", keys: hold(-0.12, 0.6, 2.6, 3.2) },
    ],
  },
  doze: {
    // Nods off over the first 3 s, then loops: the head sinks and lifts slightly as the
    // eyes flutter once.
    duration: 11,
    loopFrom: 3,
    fadeIn: 0.5,
    fadeOut: 1,
    tracks: [
      {
        target: "eyes",
        mode: "scale",
        keys: [
          [0, 1],
          [1.5, 0.35],
          [3, 0],
          [7.8, 0],
          [8.2, 0.25],
          [8.7, 0],
        ],
      },
      {
        target: "ParamAngleY",
        mode: "offset",
        keys: [
          [0, 0],
          [3, -0.45],
          [6, -0.55],
          [8.5, -0.42],
          [11, -0.45],
        ],
      },
      { target: "ParamAngleZ", mode: "offset", keys: settle(0.25, 3) },
      { target: "ParamBodyAngleY", mode: "offset", keys: settle(-0.3, 3) },
    ],
  },
};

/** Rises from 0 to `value` by `from`, holds it until `until`, and is back at 0 by `end`. */
function hold(value: number, from: number, until: number, end: number): Key[] {
  return [
    [0, 0],
    [from, value],
    [until, value],
    [end, 0],
  ];
}

/** Rises from 0 to `value` by `at` and stays there. */
function settle(value: number, at: number): Key[] {
  return [
    [0, 0],
    [at, value],
  ];
}

/** The value at `time`, eased in and out between keys. */
export function sampleKeys(keys: readonly Key[], time: number): number {
  const first = keys[0];
  if (!first) return 0;
  if (time <= first[0]) return first[1];
  for (let i = 1; i < keys.length; i++) {
    const to = keys[i];
    const from = keys[i - 1];
    if (!to || !from || time > to[0]) continue;
    const span = to[0] - from[0];
    const t = span > 0 ? (time - from[0]) / span : 1;
    return from[1] + (to[1] - from[1]) * t * t * (3 - 2 * t);
  }
  return keys[keys.length - 1]?.[1] ?? 0;
}

/** Where a preset writes. Targets the model lacks resolve to nothing. */
export interface PresetOutput {
  resolve(target: PresetTarget): readonly string[];
  offset(id: string, amount: number): void;
  set(id: string, value: number, weight: number): void;
  multiply(id: string, factor: number): void;
}

interface Playback {
  preset: Preset;
  time: number;
  /** Seconds left of the fade after a stop; undefined while playing normally. */
  release?: number;
}

// How fast a preset gives way when stopped or replaced.
const RELEASE_SECONDS = 0.4;

/** Plays one preset at a time; a new one cross-fades with the one it replaces. */
export class PresetPlayer {
  private playbacks: Playback[] = [];

  get playing(): boolean {
    return this.playbacks.length > 0;
  }

  play(name: PresetName): void {
    this.stop();
    this.playbacks.push({ preset: PRESETS[name], time: 0 });
  }

  stop(): void {
    for (const playback of this.playbacks) {
      playback.release ??= Math.min(RELEASE_SECONDS, playback.preset.fadeOut);
    }
  }

  update(deltaSeconds: number): void {
    for (const playback of this.playbacks) {
      playback.time += deltaSeconds;
      if (playback.release !== undefined) {
        playback.release -= deltaSeconds;
      }
    }
    this.playbacks = this.playbacks.filter(
      (p) =>
        (p.release === undefined || p.release > 0) &&
        (p.preset.loopFrom !== undefined || p.time < p.preset.duration),
    );
  }

  apply(output: PresetOutput): void {
    for (const playback of this.playbacks) {
      const weight = envelope(playback);
      if (weight <= 0) continue;
      const time = presetTime(playback.preset, playback.time);
      for (const track of playback.preset.tracks) {
        const value = sampleKeys(track.keys, time);
        for (const id of output.resolve(track.target)) {
          switch (track.mode) {
            case "offset":
              output.offset(id, value * weight);
              break;
            case "set":
              output.set(id, value, weight);
              break;
            case "scale":
              output.multiply(id, 1 + (value - 1) * weight);
              break;
          }
        }
      }
    }
  }
}

/** Position within the preset's keys, wrapping a looping preset. */
function presetTime({ duration, loopFrom }: Preset, time: number): number {
  if (loopFrom === undefined || time <= duration || duration <= loopFrom) {
    return time;
  }
  return loopFrom + ((time - loopFrom) % (duration - loopFrom));
}

function envelope({ preset, time, release }: Playback): number {
  const fadeIn = preset.fadeIn > 0 ? Math.min(1, time / preset.fadeIn) : 1;
  const fadeOut =
    preset.loopFrom !== undefined || preset.fadeOut <= 0
      ? 1
      : Math.min(1, (preset.duration - time) / preset.fadeOut);
  const released = release === undefined ? 1 : release / Math.min(RELEASE_SECONDS, preset.fadeOut);
  return Math.max(0, Math.min(fadeIn, fadeOut, released));
}
