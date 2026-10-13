import { describe, expect, it } from "vitest";
import { FrameClock, type FrameHost, RESAMPLE_MS } from "@/live2d/frameClock";

/** A display refreshing every `refreshMs` and timers that fire `lateMs` late. */
class FakeHost implements FrameHost {
  time = 0;
  rafs = new Map<number, (now: number) => void>();
  timers = new Map<number, { at: number; callback: () => void }>();
  wakes = 0;
  private next = 1;

  constructor(
    public refreshMs: number,
    public lateMs = 0,
  ) {}

  now() {
    return this.time;
  }

  requestAnimationFrame(callback: (now: number) => void) {
    const handle = this.next++;
    this.rafs.set(handle, callback);
    return handle;
  }

  cancelAnimationFrame(handle: number) {
    this.rafs.delete(handle);
  }

  setTimeout(callback: () => void, ms: number) {
    const handle = this.next++;
    this.timers.set(handle, { at: this.time + ms + this.lateMs, callback });
    return handle;
  }

  clearTimeout(handle: number) {
    this.timers.delete(handle);
  }

  /** Runs refreshes and timers in time order until `until`. */
  advance(until: number) {
    let vsync = Math.floor(this.time / this.refreshMs + 1) * this.refreshMs;
    while (true) {
      const timer = [...this.timers].sort(([, a], [, b]) => a.at - b.at)[0];
      const timerAt = timer ? timer[1].at : Infinity;
      const at = Math.min(timerAt, this.rafs.size > 0 ? vsync : Infinity);
      if (at > until) break;
      this.time = at;
      this.wakes++;
      if (timer && at === timerAt) {
        this.timers.delete(timer[0]);
        timer[1].callback();
      } else {
        const callbacks = [...this.rafs.values()];
        this.rafs.clear();
        for (const callback of callbacks) callback(vsync);
        vsync += this.refreshMs;
      }
      if (this.rafs.size > 0 && vsync <= this.time) {
        vsync = Math.floor(this.time / this.refreshMs + 1) * this.refreshMs;
      }
    }
    this.time = until;
  }
}

function setup(refreshMs: number, fps: { value: number }, lateMs = 0) {
  const host = new FakeHost(refreshMs, lateMs);
  const frames: { now: number; elapsed: number | undefined }[] = [];
  const clock = new FrameClock(
    (now, elapsed) => frames.push({ now, elapsed }),
    () => 1000 / fps.value,
    host,
  );
  return { host, frames, clock };
}

function rate(frames: { now: number }[], from: number, to: number) {
  return frames.filter((f) => f.now >= from && f.now < to).length / ((to - from) / 1000);
}

describe("FrameClock", () => {
  it("skips animation frames on a 60 Hz display", () => {
    const { host, frames, clock } = setup(1000 / 60, { value: 30 });
    clock.start();
    host.advance(5000);
    expect(host.timers.size).toBe(0);
    expect(rate(frames, 1000, 5000)).toBeCloseTo(30, 0);
    // Every drawn frame sits on a refresh, two refreshes apart.
    for (const { elapsed } of frames.slice(1)) {
      expect(elapsed).toBeCloseTo(1000 / 30, 5);
    }
  });

  it("runs on a timer on a 180 Hz display, waking once per frame", () => {
    const { host, frames, clock } = setup(1000 / 180, { value: 30 });
    clock.start();
    host.advance(1000);
    expect(clock.refreshMs).toBeCloseTo(1000 / 180, 5);
    const wakes = host.wakes;
    host.advance(5000);
    expect(rate(frames, 1000, 5000)).toBeCloseTo(30, 0);
    expect(host.wakes - wakes).toBe(frames.filter((f) => f.now > 1000).length);
  });

  it("keeps timer frames on a grid when timers fire late", () => {
    const { host, frames, clock } = setup(1000 / 180, { value: 30 }, 1);
    clock.start();
    host.advance(9000);
    expect(rate(frames, 1000, 9000)).toBeCloseTo(30, 0);
  });

  it("uses animation frames at 60 fps on 144 Hz and timers at 30 fps", () => {
    const fps = { value: 30 };
    const { host, clock } = setup(1000 / 144, fps);
    clock.start();
    host.advance(1000);
    expect(host.timers.size).toBe(1);
    fps.value = 60;
    host.advance(1100);
    expect(host.timers.size).toBe(0);
    expect(host.rafs.size).toBe(1);
    fps.value = 30;
    host.advance(1200);
    expect(host.timers.size).toBe(1);
  });

  it("brings a pending timer frame forward when the frame rate rises", () => {
    const fps = { value: 30 };
    const { host, frames, clock } = setup(1000 / 180, fps);
    clock.start();
    host.advance(1000);
    // Stops just after a frame.
    const count = frames.length;
    while (frames.length === count) host.advance(host.time + 0.5);
    const last = frames.at(-1)?.now ?? 0;
    fps.value = 60;
    clock.hurry();
    host.advance(last + 1000 / 60 + 0.01);
    expect(frames.at(-1)?.now).toBeCloseTo(last + 1000 / 60, 5);
  });

  it("re-measures the refresh periodically and follows a new display", () => {
    const { host, frames, clock } = setup(1000 / 180, { value: 30 });
    clock.start();
    host.advance(1000);
    expect(host.timers.size).toBe(1);
    // The window moves to a 60 Hz monitor.
    host.refreshMs = 1000 / 60;
    host.advance(1000 + RESAMPLE_MS + 1000);
    expect(host.timers.size).toBe(0);
    expect(clock.refreshMs).toBeCloseTo(1000 / 60, 5);
    expect(rate(frames, RESAMPLE_MS + 1500, RESAMPLE_MS + 2000)).toBeCloseTo(30, 0);
  });

  it("re-measures on request", () => {
    const { host, clock } = setup(1000 / 180, { value: 30 });
    clock.start();
    host.advance(1000);
    clock.resample();
    expect(host.timers.size).toBe(0);
    expect(host.rafs.size).toBe(1);
    expect(clock.refreshMs).toBeUndefined();
  });

  it("stops, and starts again with a first frame without elapsed time", () => {
    const { host, frames, clock } = setup(1000 / 180, { value: 30 });
    clock.start();
    host.advance(1000);
    clock.stop();
    expect(clock.running).toBe(false);
    const count = frames.length;
    host.advance(2000);
    expect(frames.length).toBe(count);
    clock.resample();
    expect(clock.running).toBe(false);
    clock.start();
    host.advance(2100);
    expect(frames[count]?.elapsed).toBeUndefined();
    expect(frames.length).toBeGreaterThan(count);
  });

  it("stays stopped when a frame stops it", () => {
    const host = new FakeHost(1000 / 180);
    let drawn = 0;
    const clock: FrameClock = new FrameClock(
      () => {
        drawn++;
        if (drawn === 20) clock.stop();
      },
      () => 1000 / 30,
      host,
    );
    clock.start();
    host.advance(3000);
    expect(drawn).toBe(20);
    expect(clock.running).toBe(false);
    expect(host.timers.size + host.rafs.size).toBe(0);
  });
});
