import { describe, expect, it } from "vitest";
import {
  PRESET_NAMES,
  type PresetOutput,
  PresetPlayer,
  type PresetTarget,
  sampleKeys,
} from "@/live2d/presets";

describe("sampleKeys", () => {
  const keys = [
    [1, 0],
    [3, 10],
  ] as const;

  it("holds before the first key and after the last", () => {
    expect(sampleKeys(keys, 0)).toBe(0);
    expect(sampleKeys(keys, 5)).toBe(10);
  });

  it("eases between keys", () => {
    expect(sampleKeys(keys, 2)).toBeCloseTo(5);
    expect(sampleKeys(keys, 1.5)).toBeLessThan(2.5);
    expect(sampleKeys(keys, 2.5)).toBeGreaterThan(7.5);
  });

  it("is zero without keys", () => {
    expect(sampleKeys([], 1)).toBe(0);
  });
});

type Write = [kind: string, id: string, value: number, weight?: number];

/** Records writes; `eyes` resolve to two parameters, and the model has no mouth. */
function recorder(missing: PresetTarget[] = ["mouth"]): PresetOutput & { writes: Write[] } {
  const writes: Write[] = [];
  return {
    writes,
    resolve: (target) =>
      missing.includes(target) ? [] : target === "eyes" ? ["EyeL", "EyeR"] : [target],
    offset: (id, amount) => writes.push(["offset", id, amount]),
    set: (id, value, weight) => writes.push(["set", id, value, weight]),
    setCentered: (id, amount, weight) => writes.push(["centered", id, amount, weight]),
    multiply: (id, factor) => writes.push(["multiply", id, factor]),
  };
}

function frames(player: PresetPlayer, seconds: number, step = 0.05) {
  for (let t = 0; t < seconds; t += step) player.update(step);
}

describe("PresetPlayer", () => {
  it("plays every preset to the end", () => {
    for (const name of PRESET_NAMES.filter((n) => n !== "doze")) {
      const player = new PresetPlayer();
      player.play(name);
      expect(player.playing).toBe(true);
      frames(player, 5);
      expect(player.playing).toBe(false);
    }
  });

  it("writes nothing for targets the model lacks", () => {
    const player = new PresetPlayer();
    player.play("yawn");
    frames(player, 1.5);
    const output = recorder(["mouth", "ParamAngleZ"]);
    player.apply(output);

    const ids = output.writes.map(([, id]) => id);
    expect(ids).toContain("EyeL");
    expect(ids).toContain("EyeR");
    expect(ids).toContain("ParamAngleY");
    expect(ids).not.toContain("mouth");
    expect(ids).not.toContain("ParamAngleZ");
  });

  it("fades in", () => {
    const player = new PresetPlayer();
    player.play("lookAway");
    player.update(0.05);
    const output = recorder();
    player.apply(output);

    const eye = output.writes.find(([, id]) => id === "ParamEyeBallX");
    expect(eye?.[0]).toBe("centered");
    expect(eye?.[2]).toBe(-0.8);
    expect(eye?.[3]).toBeCloseTo(1 / 3);
  });

  it("loops a looping preset until stopped, then fades it out", () => {
    const player = new PresetPlayer();
    player.play("doze");
    frames(player, 30);
    expect(player.playing).toBe(true);
    const asleep = recorder();
    player.apply(asleep);
    expect(asleep.writes).toContainEqual(["multiply", "EyeL", 0]);

    player.stop();
    player.update(0.2);
    const waking = recorder();
    player.apply(waking);
    const eye = waking.writes.find(([, id]) => id === "EyeL");
    expect(eye?.[2]).toBeGreaterThan(0);
    expect(eye?.[2]).toBeLessThan(1);

    frames(player, 1);
    expect(player.playing).toBe(false);
  });

  it("cross-fades into a new preset", () => {
    const player = new PresetPlayer();
    player.play("doze");
    frames(player, 5);
    player.play("nod");
    player.update(0.1);
    const output = recorder();
    player.apply(output);

    // Both still write: the doze on its way out, the nod on its way in.
    expect(output.writes.some(([, id]) => id === "EyeL")).toBe(true);
    expect(output.writes.filter(([, id]) => id === "ParamAngleY")).toHaveLength(2);
    frames(player, 0.5);
    const later = recorder();
    player.apply(later);
    expect(later.writes.some(([, id]) => id === "EyeL")).toBe(false);
  });
});
