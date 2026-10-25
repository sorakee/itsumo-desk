// Without voice, subtitles advance on a reading-speed timer (D57).

import type { SegmentPlayer } from "@/audio/speechQueue";

// About 18 characters a second for alphabetic text (spaces included) and 8 for CJK, where
// each character carries more.
const BASE_MS = 800;
const CHAR_MS = 55;
const CJK_CHAR_MS = 125;
const MIN_MS = 1600;
const MAX_MS = 12_000;

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** How long `text` stays on screen, in milliseconds. */
export function readingTime(text: string): number {
  let ms = BASE_MS;
  for (const char of text) {
    ms += CJK.test(char) ? CJK_CHAR_MS : CHAR_MS;
  }
  return Math.min(Math.max(ms, MIN_MS), MAX_MS);
}

/** Shows each segment for its reading time. */
export const readingTimePlayer: SegmentPlayer = (segment, done) => {
  const timer = setTimeout(done, readingTime(segment.text));
  return () => clearTimeout(timer);
};
