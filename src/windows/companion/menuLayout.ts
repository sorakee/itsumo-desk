// Geometry of the companion menu (D41): round buttons on a circle around the cursor.

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Diameter of a button in CSS pixels. */
export const BUTTON_SIZE = 46;
// Space between neighbouring buttons along the circle.
const BUTTON_GAP = 14;
// Keeps the centre roomy enough for the label bubble when there are few buttons.
const MIN_RADIUS = 64;
// Room for the offset shadow and the hover lift around the outermost buttons.
const EDGE_MARGIN = 10;
// Covers the hover growth, so a lifted button does not drop its highlight at its own edge.
const HIT_SLACK = 3;

/** Radius of the circle the button centres sit on. */
export function menuRadius(count: number): number {
  return Math.max(MIN_RADIUS, (count * (BUTTON_SIZE + BUTTON_GAP)) / (2 * Math.PI));
}

/** Distance from the centre to the menu's outer edge, shadows included. */
export function menuExtent(count: number): number {
  return menuRadius(count) + BUTTON_SIZE / 2 + EDGE_MARGIN;
}

/** Offset of button `index` from the centre: the first at the top, then clockwise. */
export function buttonOffset(index: number, count: number): Point {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
  const radius = menuRadius(count);
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

/**
 * Moves `anchor` so a menu of `count` buttons fits inside `viewport`. A viewport too small
 * for the menu on an axis centres it on that axis.
 */
export function menuCenter(anchor: Point, count: number, viewport: Size): Point {
  const extent = menuExtent(count);
  const clampAxis = (value: number, size: number) =>
    size < 2 * extent ? size / 2 : Math.min(Math.max(value, extent), size - extent);
  return { x: clampAxis(anchor.x, viewport.width), y: clampAxis(anchor.y, viewport.height) };
}

/**
 * Where the label sits: the middle of the buttons' bounding box. With an odd count the
 * circle's centre is off-centre within the buttons (three leave more room above it).
 */
export function labelOffset(count: number): Point {
  if (count === 0) return { x: 0, y: 0 };
  const offsets = Array.from({ length: count }, (_, index) => buttonOffset(index, count));
  const xs = offsets.map((offset) => offset.x);
  const ys = offsets.map((offset) => offset.y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

/** The button under a pointer at `offset` from the centre, or null if none. */
export function buttonAt(offset: Point, count: number): number | null {
  for (let index = 0; index < count; index++) {
    const button = buttonOffset(index, count);
    if (Math.hypot(offset.x - button.x, offset.y - button.y) <= BUTTON_SIZE / 2 + HIT_SLACK) {
      return index;
    }
  }
  return null;
}
