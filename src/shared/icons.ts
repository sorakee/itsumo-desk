// Stroke icons on a 24×24 grid, drawn by `Icon`. Hand-made so the app needs no icon library.

const PIN_HEAD = "M8 3h8M10 3v6l-3 3v2h10v-2l-3-3V3";
const PIN_NEEDLE = "M12 14v7";
const SLASH = "M3 3l18 18";
const PUPIL = "M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6";

export const ICONS = {
  pin: [PIN_HEAD, PIN_NEEDLE],
  pinOff: [PIN_HEAD, PIN_NEEDLE, SLASH],
  settings: [
    "M19.1 9.9 21.82 10.09 21.82 13.91 19.1 14.1 18.5 15.53 20.29 17.59 17.59 20.29 15.53 18.5 14.1 19.1 13.91 21.82 10.09 21.82 9.9 19.1 8.47 18.5 6.41 20.29 3.71 17.59 5.5 15.53 4.9 14.1 2.18 13.91 2.18 10.09 4.9 9.9 5.5 8.47 3.71 6.41 6.41 3.71 8.47 5.5 9.9 4.9 10.09 2.18 13.91 2.18 14.1 4.9 15.53 5.5 17.59 3.71 20.29 6.41 18.5 8.47Z",
    PUPIL,
  ],
  hide: ["M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z", PUPIL, SLASH],
  character: [
    "M12 3.5a4.25 4.25 0 1 0 0 8.5a4.25 4.25 0 1 0 0-8.5",
    "M4 20.5c.6-4 3.9-6.5 8-6.5s7.4 2.5 8 6.5",
  ],
  // Round caps turn the zero-length strokes into dots.
  manage: ["M4 6h.01M4 12h.01M4 18h.01", "M9 6h11M9 12h11M9 18h11"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  star: ["M12 3.5l2.6 5.3 5.9.85-4.25 4.15 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.65l5.9-.85Z"],
  pencil: ["M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16v4Z", "M13.5 6.5l4 4"],
} satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof ICONS;
