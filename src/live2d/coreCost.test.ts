import { describe, expect, it } from "vitest";
import { timeUpdate } from "@/live2d/coreCost";

/** A model whose updates take `costs[i]` ms on a fake clock, then the last cost forever. */
function fakeModel(costs: number[]) {
  let clock = 0;
  let calls = 0;
  return {
    now: () => clock,
    get calls() {
      return calls;
    },
    update() {
      clock += costs[Math.min(calls, costs.length - 1)] ?? 0;
      calls += 1;
    },
  };
}

describe("timeUpdate", () => {
  it("ignores the warm-up and takes the median", () => {
    const model = fakeModel([50, 50, 50, 2, 9, 3, 2, 3]);
    expect(timeUpdate(model, model.now)).toBe(3);
    expect(model.calls).toBe(18);
  });

  it("stops early for a model too slow to sample fully", () => {
    const model = fakeModel([200]);
    expect(timeUpdate(model, model.now)).toBe(200);
    expect(model.calls).toBeLessThan(18);
  });
});
