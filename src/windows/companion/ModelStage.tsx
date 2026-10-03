import { useEffect, useRef, useState } from "react";
import type { ModelSource } from "@/live2d/model";
import { createStage, isAbortError, type Stage } from "@/live2d/stage";
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
    let created: Stage;
    try {
      created = createStage(canvas);
    } catch (error) {
      onStatusChange({ kind: "error", message: errorMessage(error) });
      return;
    }
    setStage(created);
    return () => {
      created.dispose();
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
    stage.load(source).then(
      (manifest) => {
        console.debug("model manifest", manifest);
        onStatusChange({ kind: "ready" });
      },
      (error: unknown) => {
        if (isAbortError(error)) return;
        console.error("failed to load model", error);
        onStatusChange({ kind: "error", message: errorMessage(error) });
      },
    );
  }, [stage, source, onStatusChange]);

  return <canvas ref={canvasRef} className={styles.canvas} />;
}
