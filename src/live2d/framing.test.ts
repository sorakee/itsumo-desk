import { describe, expect, it } from "vitest";
import {
  type Bounds,
  boundsOf,
  clampFraming,
  defaultFraming,
  framingFromLayout,
  medianCenterX,
  panFraming,
  unionOf,
  upperBodyFraming,
  zoomFraming,
} from "@/live2d/framing";

function box(left: number, right: number, bottom: number, top: number): Bounds {
  return { left, right, bottom, top };
}

describe("boundsOf", () => {
  it("spans every vertex", () => {
    expect(boundsOf(new Float32Array([0, 0, 1, 2, -0.5, -1]))).toEqual(box(-0.5, 1, -1, 2));
  });

  it("is undefined for an empty mesh", () => {
    expect(boundsOf([])).toBeUndefined();
  });
});

describe("unionOf", () => {
  it("spans every box", () => {
    expect(unionOf([box(0, 1, 0, 2), box(-0.5, 0.5, -1, 0.5)])).toEqual(box(-0.5, 1, -1, 2));
  });

  it("is undefined for nothing or a degenerate extent", () => {
    expect(unionOf([])).toBeUndefined();
    expect(unionOf([box(1, 1, 1, 1)])).toBeUndefined();
  });
});

describe("medianCenterX", () => {
  it("ignores a prop held out to one side", () => {
    // A body centred on 0 and a staff far to the left (like Mao's).
    const body = [box(-0.2, 0.2, 0, 1), box(-0.1, 0.12, 0.5, 0.9), box(-0.3, 0.28, -1, 0)];
    const staff = box(-0.68, -0.12, -0.3, 0);
    expect(medianCenterX([...body, staff])).toBeCloseTo(-0.005, 2);
    expect(medianCenterX([])).toBe(0);
  });
});

describe("upperBodyFraming", () => {
  it("shows the top of the model with headroom", () => {
    // A full-body model from y = -1 (feet) to y = 1 (top of the head).
    const framing = upperBodyFraming(box(-0.3, 0.3, -1, 1));
    const span = 2 / framing.zoom;
    expect(framing.centerY + span / 2).toBeCloseTo(1.08);
    // 60% of the model is visible: from the head down to y = -0.2.
    expect(framing.centerY - span / 2).toBeCloseTo(-0.2);
  });

  it("falls back to the full canvas without bounds", () => {
    expect(upperBodyFraming(undefined)).toEqual({ zoom: 1, centerY: 0 });
  });
});

describe("framingFromLayout", () => {
  it("maps height and centre from view units", () => {
    // Canvas 4 view units tall (twice the view), its centre 1 unit below the view centre.
    expect(framingFromLayout({ height: 4, centerY: -1 }, 0.75)).toEqual({ zoom: 2, centerY: 0.5 });
  });

  it("derives height from width and position from the top edge", () => {
    // Width 3 at aspect 0.75 is 4 units tall; top at 1 puts the centre at -1.
    expect(framingFromLayout({ width: 3, top: 1 }, 0.75)).toEqual({ zoom: 2, centerY: 0.5 });
  });

  it("needs a usable size", () => {
    expect(framingFromLayout({ centerY: 0.5 }, 1)).toBeUndefined();
    expect(framingFromLayout({ height: -2 }, 1)).toBeUndefined();
  });
});

describe("defaultFraming", () => {
  const drawables = [box(-0.2, 0.2, 0, 1), box(0, 0.4, -1, 0), box(0.1, 0.3, -0.5, 0.5)];

  it("prefers the author's layout for the vertical framing", () => {
    const framing = defaultFraming({ layout: { height: 4 }, canvasAspect: 0.75, drawables });
    expect(framing.zoom).toBeCloseTo(2);
    expect(framing.centerX).toBeCloseTo(0.2);
    expect(framing.centerY).toBeCloseTo(0);
  });

  it("frames the upper body otherwise", () => {
    const framing = defaultFraming({ layout: undefined, canvasAspect: 0.75, drawables });
    expect(framing).toEqual({ ...upperBodyFraming(unionOf(drawables)), centerX: 0.2 });
  });
});

describe("zoomFraming", () => {
  it("keeps the anchored model point under the cursor", () => {
    const before = { zoom: 2, centerX: 0.1, centerY: 0.2 };
    const after = zoomFraming(before, 1.5, 0.25);
    const at = (f: typeof before) => (1 - 2 * 0.25) / f.zoom + f.centerY;
    expect(after.zoom).toBeCloseTo(3);
    expect(after.centerX).toBe(0.1);
    expect(at(after)).toBeCloseTo(at(before));
  });

  it("stops at the zoom limits", () => {
    expect(zoomFraming({ zoom: 7, centerX: 0, centerY: 0 }, 4, 0.5).zoom).toBe(8);
  });
});

describe("panFraming", () => {
  it("moves the model with the pointer", () => {
    // Dragging right and down by a quarter window at zoom 2 moves the view a quarter unit.
    const framing = panFraming({ zoom: 2, centerX: 0, centerY: 0 }, 0.25, 0.25);
    expect(framing.centerX).toBeCloseTo(-0.25);
    expect(framing.centerY).toBeCloseTo(0.25);
  });
});

describe("clampFraming", () => {
  it("keeps the window centre over the model", () => {
    const extent = box(-0.3, 0.3, -1, 1);
    expect(clampFraming({ zoom: 2, centerX: 1.5, centerY: -1.8 }, extent)).toEqual({
      zoom: 2,
      centerX: 0.3,
      centerY: -1,
    });
    // Panning far off stops at the model's edge.
    const panned = panFraming({ zoom: 2, centerX: 0, centerY: 0 }, -10, 0, extent);
    expect(panned.centerX).toBe(0.3);
  });

  it("matches the ranges the core enforces", () => {
    expect(clampFraming({ zoom: 0, centerX: -9, centerY: 9 })).toEqual({
      zoom: 0.25,
      centerX: -2,
      centerY: 2,
    });
  });
});
