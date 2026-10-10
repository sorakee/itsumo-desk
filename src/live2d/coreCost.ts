// What a model costs the Cubism Core, for the heavy-model check at import (D49) and for
// releasing the Core's memory after a heavy model.

/** The part of a Core model the timing needs. */
export interface Updatable {
  update(): void;
}

// The first updates are slower (fresh caches, the engine's tiers warming up).
const WARM_UPS = 3;
const SAMPLES = 15;
// A pathological model must not hold the import up for long; fewer samples will do.
const MAX_TIMING_MS = 500;

/**
 * The median time one Core update takes, in milliseconds. The Core does the full update
 * whether or not a parameter changed, so the model at rest times like an animated one.
 */
export function timeUpdate(model: Updatable, now: () => number = () => performance.now()): number {
  for (let i = 0; i < WARM_UPS; i++) {
    model.update();
  }
  const samples: number[] = [];
  const deadline = now() + MAX_TIMING_MS;
  do {
    const start = now();
    model.update();
    samples.push(now() - start);
  } while (samples.length < SAMPLES && now() < deadline);
  samples.sort((a, b) => a - b);
  // Never empty: the loop above runs at least once.
  return samples[samples.length >> 1] ?? 0;
}

/**
 * The size of the Core's WebAssembly heap, which every moc on the page shares. It grows to
 * fit the largest model loaded and only shrinks when the page reloads.
 */
export function coreHeapBytes(model: Live2DCubismCore.Model): number {
  return model.parameters.values.buffer.byteLength;
}
