// Writes to a model's parameters by ID, but only to parameters the manifest lists. The
// Core invents an index for an unknown ID instead of failing, so nothing else may resolve
// parameter IDs; anything the model lacks is skipped here.

import type { ModelManifest } from "@/live2d/manifest";

/** The part of a Cubism model the writer needs. */
export interface ParameterAccess {
  getParameterValueByIndex(index: number): number;
  /** Clamps to the parameter's range; `weight` blends from the current value. */
  setParameterValueByIndex(index: number, value: number, weight?: number): void;
}

interface Slot {
  index: number;
  /** Half the parameter's range, the unit of `offset`. */
  halfRange: number;
}

export class ModelParameters {
  private readonly slots = new Map<string, Slot>();

  constructor(
    private readonly model: ParameterAccess,
    manifest: Pick<ModelManifest, "parameters">,
  ) {
    manifest.parameters.forEach(({ id, min, max }, index) => {
      if (max > min) {
        this.slots.set(id, { index, halfRange: (max - min) / 2 });
      }
    });
  }

  has(id: string): boolean {
    return this.slots.has(id);
  }

  get(id: string): number | undefined {
    const slot = this.slots.get(id);
    return slot && this.model.getParameterValueByIndex(slot.index);
  }

  /** Moves towards `value` by `weight` (1 replaces the current value). */
  set(id: string, value: number, weight = 1): void {
    const slot = this.slots.get(id);
    if (slot && weight > 0) {
      this.model.setParameterValueByIndex(slot.index, value, Math.min(weight, 1));
    }
  }

  /**
   * Adds `amount` half-ranges, so one value suits every model: 0.5 turns a ±30° head by 15°
   * and a ±10° body by 5°.
   */
  offset(id: string, amount: number): void {
    const slot = this.slots.get(id);
    if (slot && amount !== 0) {
      const current = this.model.getParameterValueByIndex(slot.index);
      this.model.setParameterValueByIndex(slot.index, current + amount * slot.halfRange);
    }
  }

  multiply(id: string, factor: number): void {
    const slot = this.slots.get(id);
    if (slot && factor !== 1) {
      const current = this.model.getParameterValueByIndex(slot.index);
      this.model.setParameterValueByIndex(slot.index, current * factor);
    }
  }
}
