import { useEffect, useRef, useState } from "react";
import { loadFraming } from "@/ipc";
import type { ModelSource } from "@/live2d/model";
import { createStage, isAbortError, type Stage } from "@/live2d/stage";
import { startDevShortcuts } from "@/windows/companion/devShortcuts";
import { startInteraction } from "@/windows/companion/interaction";
import styles from "./ModelStage.module.css";

export type StageStatus =
  | { kind: "empty" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

interface ModelStageProps {
  source: ModelSource | null;
  onStatusChange: (status: StageStatus) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Hosts the Live2D canvas. The stage itself lives outside React; see `@/live2d/stage`. */
export function ModelStage({ source, onStatusChange }: ModelStageProps) {
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

  useEffect(() => {
    if (!stage) return;
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
