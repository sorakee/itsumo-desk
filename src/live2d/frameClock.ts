// Decides when the stage draws. Skipping `requestAnimationFrame` callbacks keeps frames on
// the display's refresh, but on a high-refresh monitor it wakes the page for every refresh
// (173 times a second on 180 Hz to draw 30). When the display refreshes at least
// `TIMER_MIN_REFRESHES` times per drawn frame, frames run on a timer instead: a timer frame
// drifts against the refresh and may show one refresh late, which is a small part of a frame
// there but a visible stutter at 60 Hz.

/** The scheduling calls the clock uses, injectable for tests. */
export interface FrameHost {
  now(): number;
  requestAnimationFrame(callback: (now: number) => void): number;
  cancelAnimationFrame(handle: number): void;
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

const browserHost: FrameHost = {
  now: () => performance.now(),
  requestAnimationFrame: (callback) => requestAnimationFrame(callback),
  cancelAnimationFrame: (handle) => cancelAnimationFrame(handle),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle),
};

/** Refreshes per drawn frame from which frames run on a timer. */
export const TIMER_MIN_REFRESHES = 3;
// Refresh intervals measured before trusting the estimate; the first callbacks after an idle
// spell can run off the refresh.
const MIN_SAMPLES = 6;
const MAX_SAMPLES = 9;
// Timer frames go back to animation frames this often to re-measure the refresh, which
// changes when the window moves to another monitor.
export const RESAMPLE_MS = 10_000;
// An animation frame slightly early still counts, so vsync jitter does not skip a frame.
const RAF_SLACK_MS = 1;

export class FrameClock {
  private readonly onFrame: (now: number, elapsedMs: number | undefined) => void;
  private readonly frameMs: () => number;
  private readonly host: FrameHost;
  private active = false;
  private raf: number | undefined;
  private timer: number | undefined;
  private lastDrawn: number | undefined;
  /** When the next timer frame is due; frames keep to this grid so lateness does not add up. */
  private due = 0;
  private lastCallback: number | undefined;
  private samples: number[] = [];
  private resampleAt = 0;

  /**
   * `onFrame` draws a frame, given the time since the last one (undefined for the first
   * after `start`); `frameMs` is the wanted time between frames, read for every frame.
   */
  constructor(
    onFrame: (now: number, elapsedMs: number | undefined) => void,
    frameMs: () => number,
    host: FrameHost = browserHost,
  ) {
    this.onFrame = onFrame;
    this.frameMs = frameMs;
    this.host = host;
  }

  get running(): boolean {
    return this.active;
  }

  /** The measured refresh interval, once there are enough samples. */
  get refreshMs(): number | undefined {
    if (this.samples.length < MIN_SAMPLES) return undefined;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.lastDrawn = undefined;
    this.samples = [];
    this.requestRaf();
  }

  stop() {
    this.active = false;
    if (this.raf !== undefined) this.host.cancelAnimationFrame(this.raf);
    if (this.timer !== undefined) this.host.clearTimeout(this.timer);
    this.raf = undefined;
    this.timer = undefined;
  }

  /** Measures the refresh again from the next frame on, if running. */
  resample() {
    this.samples = [];
    if (this.timer !== undefined) {
      this.host.clearTimeout(this.timer);
      this.timer = undefined;
      this.requestRaf();
    }
  }

  /** The wanted frame time dropped: brings a pending timer frame forward. */
  hurry() {
    if (this.timer === undefined || this.lastDrawn === undefined) return;
    const due = this.lastDrawn + this.frameMs();
    if (due >= this.due) return;
    this.due = due;
    this.host.clearTimeout(this.timer);
    this.timer = undefined;
    this.requestTimer();
  }

  private requestRaf() {
    this.lastCallback = undefined;
    this.raf = this.host.requestAnimationFrame((now) => this.onAnimationFrame(now));
  }

  private requestTimer() {
    this.timer = this.host.setTimeout(
      () => this.onTimer(),
      Math.max(0, this.due - this.host.now()),
    );
  }

  private onAnimationFrame(now: number) {
    this.raf = undefined;
    if (this.lastCallback !== undefined) {
      this.samples.push(now - this.lastCallback);
      if (this.samples.length > MAX_SAMPLES) this.samples.shift();
    }
    this.lastCallback = now;
    const frameMs = this.frameMs();
    if (this.lastDrawn !== undefined && now - this.lastDrawn < frameMs - RAF_SLACK_MS) {
      this.raf = this.host.requestAnimationFrame((next) => this.onAnimationFrame(next));
      return;
    }
    this.draw(now);
    if (!this.active) return;
    if (this.timerFits(frameMs)) {
      this.due = now + frameMs;
      this.resampleAt = now + RESAMPLE_MS;
      this.requestTimer();
    } else {
      this.raf = this.host.requestAnimationFrame((next) => this.onAnimationFrame(next));
    }
  }

  private onTimer() {
    this.timer = undefined;
    const now = this.host.now();
    this.draw(now);
    if (!this.active) return;
    const frameMs = this.frameMs();
    const resampling = now >= this.resampleAt;
    if (resampling || !this.timerFits(frameMs)) {
      if (resampling) this.samples = [];
      this.requestRaf();
      return;
    }
    // Keeps to the grid unless a stall left it a frame behind.
    const next = this.due + frameMs;
    this.due = next > now ? next : now + frameMs;
    this.requestTimer();
  }

  private timerFits(frameMs: number): boolean {
    const refresh = this.refreshMs;
    // Measured intervals are rounded (180 Hz reads 5.6 ms), so 60 fps there is 2.98 refreshes.
    return refresh !== undefined && frameMs / refresh >= TIMER_MIN_REFRESHES - 0.1;
  }

  private draw(now: number) {
    const elapsed = this.lastDrawn === undefined ? undefined : now - this.lastDrawn;
    this.lastDrawn = now;
    this.onFrame(now, elapsed);
  }
}
