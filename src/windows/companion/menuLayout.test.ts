import { describe, expect, it } from "vitest";
import {
  BUTTON_SIZE,
  buttonAt,
  buttonOffset,
  labelOffset,
  menuCenter,
  menuExtent,
  menuRadius,
} from "@/windows/companion/menuLayout";

describe("menuRadius", () => {
  it("keeps a minimum for few buttons and grows for many", () => {
    expect(menuRadius(3)).toBe(menuRadius(4));
    expect(menuRadius(12)).toBeGreaterThan(menuRadius(4));
  });

  it("leaves neighbouring buttons apart", () => {
    for (const count of [3, 4, 8, 12]) {
      const a = buttonOffset(0, count);
      const b = buttonOffset(1, count);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(BUTTON_SIZE);
    }
  });
});

describe("menuExtent", () => {
  it("fits eight buttons inside the smallest companion window", () => {
    expect(2 * menuExtent(8)).toBeLessThanOrEqual(240);
  });
});

describe("buttonOffset", () => {
  it("starts at the top and goes clockwise", () => {
    const top = buttonOffset(0, 4);
    const right = buttonOffset(1, 4);
    expect(top.x).toBeCloseTo(0);
    expect(top.y).toBeLessThan(0);
    expect(right.x).toBeGreaterThan(0);
    expect(right.y).toBeCloseTo(0);
  });
});

describe("menuCenter", () => {
  const viewport = { width: 480, height: 640 };

  it("keeps an anchor that already fits", () => {
    expect(menuCenter({ x: 240, y: 300 }, 3, viewport)).toEqual({ x: 240, y: 300 });
  });

  it("pushes the menu inside near the edges", () => {
    const extent = menuExtent(3);
    expect(menuCenter({ x: 5, y: 635 }, 3, viewport)).toEqual({ x: extent, y: 640 - extent });
  });

  it("centres the menu on an axis too small for it", () => {
    expect(menuCenter({ x: 10, y: 10 }, 3, { width: 100, height: 640 }).x).toBe(50);
  });
});

describe("labelOffset", () => {
  it("stays at the centre for an even count", () => {
    const offset = labelOffset(4);
    expect(offset.x).toBeCloseTo(0);
    expect(offset.y).toBeCloseTo(0);
  });

  it("moves up for three buttons, between the top one and the lower two", () => {
    const offset = labelOffset(3);
    const top = buttonOffset(0, 3);
    const lower = buttonOffset(1, 3);
    expect(offset.x).toBeCloseTo(0);
    expect(offset.y - top.y).toBeCloseTo(lower.y - offset.y);
  });
});

describe("buttonAt", () => {
  const radius = menuRadius(4);

  it("picks the button under the pointer", () => {
    expect(buttonAt({ x: 0, y: -radius }, 4)).toBe(0);
    expect(buttonAt({ x: radius, y: 0 }, 4)).toBe(1);
    expect(buttonAt({ x: 0, y: radius }, 4)).toBe(2);
    expect(buttonAt({ x: -radius, y: 0 }, 4)).toBe(3);
  });

  it("picks a button up to its edge", () => {
    expect(buttonAt({ x: BUTTON_SIZE / 2, y: -radius }, 4)).toBe(0);
  });

  it("picks nothing between buttons, at the centre, or outside", () => {
    expect(buttonAt({ x: radius * 0.7, y: -radius * 0.7 }, 4)).toBeNull();
    expect(buttonAt({ x: 0, y: 0 }, 4)).toBeNull();
    expect(buttonAt({ x: 0, y: -(radius + BUTTON_SIZE) }, 4)).toBeNull();
    expect(buttonAt({ x: 0, y: -radius }, 0)).toBeNull();
  });
});
