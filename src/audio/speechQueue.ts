// The speech queue (`04-voice.md`): a reply's segments, shown one at a time in order. A
// player decides how long each one lasts: a reading-speed timer while there is no voice,
// the audio clip from M3, with the queue unchanged.

export interface Segment {
  turn: number;
  /** From 0 within the turn. */
  index: number;
  text: string;
}

/** Starts a segment and calls `done` when it has had its time. Returns a function that stops it. */
export type SegmentPlayer = (segment: Segment, done: () => void) => () => void;

interface SpeechQueueOptions {
  play: SegmentPlayer;
  /** A segment goes on screen, or with null the last one comes off. */
  onShow: (segment: Segment | null) => void;
  /** How long a reply's last segment stays up after it has had its time. */
  holdMs: number;
}

export interface SpeechQueue {
  push(segment: Segment): void;
  /** No more segments will come for `turn`. */
  end(turn: number): void;
  /**
   * Ignores turns older than `turn`, taking an older one off screen: the user sent a new
   * message, so the reply in progress is interrupted.
   */
  expect(turn: number): void;
  dispose(): void;
}

export function createSpeechQueue({ play, onShow, holdMs }: SpeechQueueOptions): SpeechQueue {
  // The turn being shown, and the oldest turn still accepted.
  let turn = -1;
  let floor = 0;
  let queue: Segment[] = [];
  let ended = false;
  let showing = false;
  let playing = false;
  let stop: (() => void) | null = null;
  let hold: ReturnType<typeof setTimeout> | undefined;
  // Bumped whenever playback is cut short, so a stopped player's late `done` is ignored.
  let generation = 0;

  function cancelHold() {
    clearTimeout(hold);
    hold = undefined;
  }

  function reset() {
    generation += 1;
    stop?.();
    stop = null;
    playing = false;
    cancelHold();
    queue = [];
    ended = false;
    if (showing) {
      showing = false;
      onShow(null);
    }
  }

  /** Whether `next` is the current turn, moving to it if it is newer. */
  function accepts(next: number): boolean {
    if (next < floor || next < turn) return false;
    if (next > turn) {
      reset();
      turn = next;
    }
    return true;
  }

  function start(segment: Segment) {
    const id = ++generation;
    playing = true;
    showing = true;
    cancelHold();
    onShow(segment);
    const stopThis = play(segment, () => {
      if (id !== generation) return;
      playing = false;
      stop = null;
      advance();
    });
    // A player may finish synchronously, in which case the next one already took over.
    if (id === generation && playing) stop = stopThis;
  }

  function advance() {
    const segment = queue.shift();
    if (segment) {
      start(segment);
    } else if (ended && showing) {
      hold = setTimeout(() => {
        hold = undefined;
        showing = false;
        onShow(null);
      }, holdMs);
    }
    // Otherwise the segment stays up until the next one arrives.
  }

  return {
    push(segment) {
      if (!accepts(segment.turn)) return;
      queue.push(segment);
      if (!playing) advance();
    },
    end(ofTurn) {
      if (!accepts(ofTurn)) return;
      ended = true;
      if (!playing) advance();
    },
    expect(next) {
      floor = Math.max(floor, next);
      if (turn < floor) reset();
    },
    dispose() {
      generation += 1;
      stop?.();
      cancelHold();
    },
  };
}
