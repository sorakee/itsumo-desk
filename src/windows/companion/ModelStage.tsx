import { useEffect, useRef, useState } from "react";
import { loadFraming } from "@/ipc";
import type { ModelSource } from "@/live2d/model";
import { createStage, isAbortError, type Stage, type StageMapping } from "@/live2d/stage";
import { errorMessage } from "@/shared/errorMessage";
import { startDevShortcuts } from "@/windows/companion/devShortcuts";
import { startInteraction } from "@/windows/companion/interaction";
import styles from "./ModelStage.module.css";

export type StageStatus =
  | { kind: "empty" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

// The Cubism Core's heap grows to fit the largest model the page has loaded and never
// shrinks: 256 MB after 阿库露中式 (D49) versus the 16 MB default that typical models fit in.
// Above this, a change of model reloads the page instead, which loads the new active
// character into a fresh heap.
const RELOAD_HEAP_BYTES = 64 * 1024 * 1024;

interface ModelStageProps {
  /** Null shows nothing; undefined means the source is not known yet. */
  source: ModelSource | null | undefined;
  /** The character's mapping; changing it does not reload the model. */
  mapping: StageMapping | null;
  onStatusChange: (status: StageStatus) => void;
}

/** Hosts the Live2D canvas. The stage itself lives outside React; see `@/live2d/stage`. */
export function ModelStage({ source, mapping, onStatusChange }: ModelStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState<Stage | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let created: Stage | null = null;
    try {
      created = createStage(canvas);
    } catch (error) {
      onStatusChange({ kind: "error", message: errorMessage(error) });
    }
    // Runs without a stage too, so the error placeholder can still be dragged.
    const stopInteraction = startInteraction(created);
    const stopShortcuts = import.meta.env.DEV && created ? startDevShortcuts(created) : undefined;
    setStage(created);
    return () => {
      // First: it saves pending framing changes, which reads the stage.
      stopInteraction();
      stopShortcuts?.();
      created?.dispose();
      setStage(null);
    };
  }, [onStatusChange]);

  // Before the load below, so a new model starts with its own mapping.
  useEffect(() => {
    stage?.setMapping(mapping);
  }, [stage, mapping]);

  useEffect(() => {
    if (!stage || source === undefined) return;
    if ((stage.coreHeapBytes ?? 0) > RELOAD_HEAP_BYTES) {
      location.reload();
      return;
    }
    if (!source) {
      onStatusChange({ kind: "empty" });
      return;
    }
    onStatusChange({ kind: "loading" });
    let cancelled = false;
    loadFraming(source.id)
      .catch((error: unknown) => {
        console.warn("failed to load the saved framing", error);
        return null;
      })
      .then((framing) => (cancelled ? undefined : stage.load(source, framing ?? undefined)))
      .then(
        (manifest) => {
          if (!manifest) return;
          console.debug("model manifest", manifest);
          onStatusChange({ kind: "ready" });
        },
        (error: unknown) => {
          if (isAbortError(error)) return;
          console.error("failed to load model", error);
          onStatusChange({ kind: "error", message: errorMessage(error) });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [stage, source, onStatusChange]);

  return <canvas ref={canvasRef} className={styles.canvas} />;
}
