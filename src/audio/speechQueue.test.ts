import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readingTime, readingTimePlayer } from "@/audio/readingTime";
import { createSpeechQueue, type Segment } from "@/audio/speechQueue";

const HOLD_MS = 500;

function segment(turn: number, index: number, text = `turn ${turn} segment ${index}`): Segment {
  return { turn, index, text };
}

/** A queue whose segments each last `ms`, recording what is on screen. */
function setup(ms = 1000) {
  const shown: (string | null)[] = [];
  const queue = createSpeechQueue({
    play: (_segment, done) => {
      const timer = setTimeout(done, ms);
      return () => clearTimeout(timer);
    },
    onShow: (s) => shown.push(s?.text ?? null),
    holdMs: HOLD_MS,
  });
  return { queue, shown };
}

describe("createSpeechQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows segments one at a time and clears after the last one", () => {
    const { queue, shown } = setup();
    queue.push(segment(1, 0, "a"));
    queue.push(segment(1, 1, "b"));
    expect(shown).toEqual(["a"]);
    vi.advanceTimersByTime(1000);
    expect(shown).toEqual(["a", "b"]);
    queue.end(1);
    vi.advanceTimersByTime(1000 + HOLD_MS - 1);
    expect(shown).toEqual(["a", "b"]);
    vi.advanceTimersByTime(1);
    expect(shown).toEqual(["a", "b", null]);
  });

  it("keeps a segment up while the next one is still streaming", () => {
    const { queue, shown } = setup();
    queue.push(segment(1, 0, "a"));
    vi.advanceTimersByTime(5000);
    expect(shown).toEqual(["a"]);
    queue.push(segment(1, 1, "b"));
    expect(shown).toEqual(["a", "b"]);
    queue.end(1);
    vi.advanceTimersByTime(1000 + HOLD_MS);
    expect(shown).toEqual(["a", "b", null]);
  });

  it("a newer turn replaces the one on screen", () => {
    const { queue, shown } = setup();
    queue.push(segment(1, 0, "a"));
    queue.push(segment(1, 1, "b"));
    queue.push(segment(2, 0, "new"));
    expect(shown).toEqual(["a", null, "new"]);
    // Late segments of the old turn are dropped.
    queue.push(segment(1, 2, "late"));
    queue.end(1);
    vi.advanceTimersByTime(5000);
    expect(shown).toEqual(["a", null, "new"]);
  });

  it("expect interrupts an older turn and drops its late segments", () => {
    const { queue, shown } = setup();
    queue.push(segment(5, 0, "aborted"));
    queue.expect(6);
    expect(shown).toEqual(["aborted", null]);
    queue.push(segment(5, 1, "stale"));
    queue.push(segment(6, 0, "fresh"));
    expect(shown).toEqual(["aborted", null, "fresh"]);
  });

  it("a turn that ends with nothing to show leaves the screen alone", () => {
    const { queue, shown } = setup();
    queue.end(1);
    vi.advanceTimersByTime(5000);
    expect(shown).toEqual([]);
  });

  it("copes with a player that finishes at once", () => {
    const shown: (string | null)[] = [];
    const queue = createSpeechQueue({
      play: (_segment, done) => {
        done();
        return () => {};
      },
      onShow: (s) => shown.push(s?.text ?? null),
      holdMs: 0,
    });
    queue.push(segment(1, 0, "a"));
    queue.push(segment(1, 1, "b"));
    queue.end(1);
    vi.advanceTimersByTime(0);
    expect(shown).toEqual(["a", "b", null]);
  });

  it("dispose stops playback without further callbacks", () => {
    const { queue, shown } = setup();
    queue.push(segment(1, 0, "a"));
    queue.push(segment(1, 1, "b"));
    queue.end(1);
    queue.dispose();
    vi.advanceTimersByTime(10_000);
    expect(shown).toEqual(["a"]);
  });

  it("works with the reading-time player", () => {
    const shown: (string | null)[] = [];
    const queue = createSpeechQueue({
      play: readingTimePlayer,
      onShow: (s) => shown.push(s?.text ?? null),
      holdMs: 0,
    });
    queue.push(segment(1, 0, "Hello there, friend!"));
    queue.end(1);
    vi.advanceTimersByTime(readingTime("Hello there, friend!") + 1);
    expect(shown).toEqual(["Hello there, friend!", null]);
  });
});

describe("readingTime", () => {
  it("grows with the text, slower for CJK, within bounds", () => {
    expect(readingTime("Hi!")).toBe(1600);
    const latin = readingTime("Good morning! Did you sleep well?");
    expect(latin).toBeGreaterThan(1600);
    expect(readingTime("おはよう！よく眠れた？")).toBeGreaterThan(readingTime("おはよう！"));
    // Same length, CJK takes longer.
    expect(readingTime("あいうえおかきくけこさしすせそ")).toBeGreaterThan(
      readingTime("abcdefghijklmno"),
    );
    expect(readingTime("x".repeat(1000))).toBe(12_000);
  });
});
