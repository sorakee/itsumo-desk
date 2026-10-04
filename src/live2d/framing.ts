// Which part of the model fills the window. Everything here is in model units: the model
// canvas is 2 units tall and centred on the origin, y pointing up.

import type { ModelLayout } from "@/live2d/modelSettings";

export interface Framing {
  /** How many window heights the model canvas spans; 1 fits it exactly. */
  zoom: number;
  /** The model-space point shown at the window's centre. */
  centerX: number;
  centerY: number;
}

export interface Bounds {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

export interface ModelPoint {
  x: number;
  y: number;
}

/** What the default framing is derived from. */
export interface ModelShape {
  layout: ModelLayout | undefined;
  /** Width over height of the model canvas. */
  canvasAspect: number;
  /** The extent of each visible drawable. */
  drawables: Bounds[];
}

// Must match `Framing::validated` in src-tauri/src/settings/mod.rs, so what is shown is
// what gets saved.
const ZOOM_RANGE = [0.25, 8] as const;
const CENTER_RANGE = [-2, 2] as const;

/** Where the face is assumed to be without a head hit area: this share down the model. */
const FACE_FROM_TOP = 0.12;

/** Share of the visible model, from the top, that the default framing shows. */
const UPPER_BODY_SHARE = 0.6;
/** Headroom above the model's top, as a share of its height. */
const TOP_MARGIN = 0.04;

type Vertical = Pick<Framing, "zoom" | "centerY">;

const FULL_CANVAS: Vertical = { zoom: 1, centerY: 0 };

function clamp(value: number, [min, max]: readonly [number, number]): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Clamps to the ranges the core accepts and, given the model's `extent`, keeps the window's
 * centre over the model, so it can never be panned out of reach.
 */
export function clampFraming({ zoom, centerX, centerY }: Framing, extent?: Bounds): Framing {
  const within = (value: number, min = -Infinity, max = Infinity) =>
    clamp(value, [Math.max(CENTER_RANGE[0], min), Math.min(CENTER_RANGE[1], max)]);
  return {
    zoom: clamp(zoom, ZOOM_RANGE),
    centerX: within(centerX, extent?.left, extent?.right),
    centerY: within(centerY, extent?.bottom, extent?.top),
  };
}

/** The extent of a mesh given as a flat `[x, y, x, y, ...]` array. */
export function boundsOf(vertices: ArrayLike<number>): Bounds | undefined {
  let left = Infinity;
  let right = -Infinity;
  let bottom = Infinity;
  let top = -Infinity;
  for (let i = 0; i + 1 < vertices.length; i += 2) {
    const x = vertices[i] ?? 0;
    const y = vertices[i + 1] ?? 0;
    left = Math.min(left, x);
    right = Math.max(right, x);
    bottom = Math.min(bottom, y);
    top = Math.max(top, y);
  }
  return right >= left && top >= bottom ? { left, right, bottom, top } : undefined;
}

export function unionOf(all: Bounds[]): Bounds | undefined {
  if (all.length === 0) {
    return undefined;
  }
  const union = {
    left: Math.min(...all.map((b) => b.left)),
    right: Math.max(...all.map((b) => b.right)),
    bottom: Math.min(...all.map((b) => b.bottom)),
    top: Math.max(...all.map((b) => b.top)),
  };
  return union.right > union.left && union.top > union.bottom ? union : undefined;
}

/**
 * Where the body is horizontally: the median of the drawables' centres. A prop held out to
 * one side is a few drawables among a hundred, so unlike the overall extent it barely
 * moves this.
 */
export function medianCenterX(all: Bounds[]): number {
  const centres = all.map((b) => (b.left + b.right) / 2).sort((a, b) => a - b);
  if (centres.length === 0) {
    return 0;
  }
  const middle = Math.floor(centres.length / 2);
  return centres.length % 2 === 1
    ? (centres[middle] ?? 0)
    : ((centres[middle - 1] ?? 0) + (centres[middle] ?? 0)) / 2;
}

/**
 * Converts a model3.json `Layout` to a vertical framing. Layout values are in view units,
 * where the window is 2 units tall.
 */
export function framingFromLayout(layout: ModelLayout, canvasAspect: number): Vertical | undefined {
  const height =
    layout.height ?? (layout.width !== undefined ? layout.width / canvasAspect : undefined);
  if (height === undefined || !(height > 0)) {
    return undefined;
  }
  const top = layout.top ?? layout.y;
  const center =
    layout.centerY ??
    (top !== undefined ? top - height / 2 : undefined) ??
    (layout.bottom !== undefined ? layout.bottom + height / 2 : undefined) ??
    0;
  return { zoom: height / 2, centerY: (-2 * center) / height };
}

/** The upper part of the model's visible extent, with a little headroom. */
export function upperBodyFraming(bounds: Bounds | undefined): Vertical {
  if (!bounds) {
    return FULL_CANVAS;
  }
  const height = bounds.top - bounds.bottom;
  const margin = height * TOP_MARGIN;
  const span = height * UPPER_BODY_SHARE + margin;
  return { zoom: 2 / span, centerY: bounds.top + margin - span / 2 };
}

/** The author's `Layout` if there is one, otherwise the upper body; centred on the body. */
export function defaultFraming({ layout, canvasAspect, drawables }: ModelShape): Framing {
  const vertical =
    (layout && framingFromLayout(layout, canvasAspect)) ?? upperBodyFraming(unionOf(drawables));
  return clampFraming({ ...vertical, centerX: medianCenterX(drawables) });
}

/** Zooms by `factor`, keeping the model point at `anchorY` (window share from the top) still. */
export function zoomFraming(
  framing: Framing,
  factor: number,
  anchorY: number,
  extent?: Bounds,
): Framing {
  const anchor = (1 - 2 * anchorY) / framing.zoom + framing.centerY;
  const zoom = clamp(framing.zoom * factor, ZOOM_RANGE);
  const centerY = anchor + (framing.centerY - anchor) * (framing.zoom / zoom);
  return clampFraming({ ...framing, zoom, centerY }, extent);
}

/**
 * Moves the model with the pointer by `dx` right and `dy` down, both as shares of the window
 * height (the projection keeps model units square).
 */
export function panFraming(framing: Framing, dx: number, dy: number, extent?: Bounds): Framing {
  return clampFraming(
    {
      ...framing,
      centerX: framing.centerX - (2 * dx) / framing.zoom,
      centerY: framing.centerY + (2 * dy) / framing.zoom,
    },
    extent,
  );
}

/**
 * Where the character looks from: the centre of its head hit area if it has one, otherwise
 * a point near the top of the visible model, above the body's centre.
 */
export function faceAnchor(drawables: Bounds[], head?: Bounds): ModelPoint | undefined {
  if (head) {
    return { x: (head.left + head.right) / 2, y: (head.bottom + head.top) / 2 };
  }
  const extent = unionOf(drawables);
  if (!extent) {
    return undefined;
  }
  return {
    x: medianCenterX(drawables),
    y: extent.top - (extent.top - extent.bottom) * FACE_FROM_TOP,
  };
}

/**
 * Where a model point appears in a window of `aspect` (width over height), as shares of
 * the window from its top-left corner.
 */
export function modelToWindow(
  { zoom, centerX, centerY }: Framing,
  aspect: number,
  point: ModelPoint,
): ModelPoint {
  return {
    x: 0.5 + ((point.x - centerX) * zoom) / (2 * aspect),
    y: 0.5 - ((point.y - centerY) * zoom) / 2,
  };
}
