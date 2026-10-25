// Where the speech bubble goes (D57): beside the head, on the side with more room, kept
// inside the window. The window is narrow (240 px at 0.5×), so the bubble may overlap the
// hair or a shoulder; it is not a hit region, so that costs nothing but the view.

import type { Point } from "@/live2d/stage";

export interface Size {
  width: number;
  height: number;
}

export interface BubblePlacement {
  left: number;
  top: number;
  /** Where the tail leaves the bubble's bottom edge, from its left side. */
  tailX: number;
}

const MARGIN = 8;
/** How far from the face's centre the bubble's near edge sits, as a share of the width. */
const SIDE_GAP = 0.1;
/** How far above the face the bubble's bottom sits, as a share of the height. */
const RAISE = 0.04;
/** Keeps the tail off the bubble's rounded corners. */
const TAIL_INSET = 22;

/**
 * Places a bubble of `bubble` size in a `view`, keeping clear of `bottomReserve` pixels at
 * the bottom (the chat input). Without a face it sits at the top centre.
 */
export function placeBubble(
  face: Point | undefined,
  bubble: Size,
  view: Size,
  bottomReserve: number,
): BubblePlacement {
  const maxLeft = Math.max(MARGIN, view.width - bubble.width - MARGIN);
  const maxTop = Math.max(MARGIN, view.height - bottomReserve - bubble.height - MARGIN);
  if (!face) {
    const left = clamp((view.width - bubble.width) / 2, MARGIN, maxLeft);
    return { left, top: MARGIN, tailX: bubble.width / 2 };
  }
  const gap = view.width * SIDE_GAP;
  const toLeft = face.x >= view.width / 2;
  const left = clamp(toLeft ? face.x - gap - bubble.width : face.x + gap, MARGIN, maxLeft);
  const top = clamp(face.y - view.height * RAISE - bubble.height, MARGIN, maxTop);
  const tailX = clamp(face.x - left, TAIL_INSET, Math.max(TAIL_INSET, bubble.width - TAIL_INSET));
  return { left, top, tailX };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
