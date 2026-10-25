import { describe, expect, it } from "vitest";
import { placeBubble } from "@/windows/companion/bubblePlacement";

const VIEW = { width: 480, height: 640 };
const BUBBLE = { width: 200, height: 60 };

describe("placeBubble", () => {
  it("goes beside and above the face, on the side with more room", () => {
    const right = placeBubble({ x: 200, y: 250 }, BUBBLE, VIEW, 0);
    expect(right.left).toBeGreaterThan(200);
    expect(right.top + BUBBLE.height).toBeLessThan(250);
    const left = placeBubble({ x: 300, y: 250 }, BUBBLE, VIEW, 0);
    expect(left.left + BUBBLE.width).toBeLessThan(300);
  });

  it("stays inside the window and above the input", () => {
    const small = { width: 240, height: 320 };
    for (const face of [
      { x: 120, y: 20 },
      { x: -50, y: 900 },
      { x: 400, y: 300 },
    ]) {
      const placed = placeBubble(face, BUBBLE, small, 48);
      expect(placed.left).toBeGreaterThanOrEqual(8);
      expect(placed.left + BUBBLE.width).toBeLessThanOrEqual(small.width - 8 + 0.001);
      expect(placed.top).toBeGreaterThanOrEqual(8);
      expect(placed.top + BUBBLE.height).toBeLessThanOrEqual(small.height - 48 - 8);
    }
  });

  it("points the tail at the face, off the corners", () => {
    const placed = placeBubble({ x: 200, y: 250 }, BUBBLE, VIEW, 0);
    expect(placed.tailX).toBe(22);
    const over = placeBubble({ x: 240, y: 250 }, { width: 460, height: 60 }, VIEW, 0);
    expect(over.left + over.tailX).toBeCloseTo(240);
  });

  it("sits at the top centre without a face", () => {
    expect(placeBubble(undefined, BUBBLE, VIEW, 0)).toEqual({ left: 140, top: 8, tailX: 100 });
  });
});
