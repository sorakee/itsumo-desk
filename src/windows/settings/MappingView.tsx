import { useEffect, useMemo, useRef, useState } from "react";
import { type CharacterMapping, characterMapping } from "@/ipc";
import type { ModelSource } from "@/live2d/model";
import { errorMessage } from "@/shared/errorMessage";
import { Icon } from "@/shared/Icon";
import { useCharactersStore } from "@/stores/characters";
import { MappingSummary } from "@/windows/settings/MappingSummary";
import { PreviewControls } from "@/windows/settings/PreviewControls";
import { usePreviewStage } from "@/windows/settings/usePreviewStage";
import styles from "./MappingView.module.css";

interface MappingViewProps {
  id: string;
  onBack: () => void;
}

/** One character's expressions, motions and mapping, with a live preview. */
export function MappingView({ id, onBack }: MappingViewProps) {
  const name = useCharactersStore((state) => state.characters?.find((c) => c.id === id)?.name);
  const [data, setData] = useState<CharacterMapping | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    characterMapping(id).then(
      (loaded) => {
        if (!cancelled) setData(loaded);
      },
      (failed: unknown) => {
        if (!cancelled) setError(errorMessage(failed));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  const source = useMemo<ModelSource | undefined>(
    () => (data ? { id, url: data.modelUrl, extras: data.extras } : undefined),
    [id, data],
  );
  const { status: preview, resetView } = usePreviewStage(canvasRef, source);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.back}
          aria-label="Back to Settings"
          title="Back"
          onClick={onBack}
        >
          <Icon name="back" />
        </button>
        <div className={styles.heading}>
          <h1 className={styles.title}>{name ?? id}</h1>
          <p className={styles.subtitle}>Expressions, motions and mapping</p>
        </div>
      </header>

      <div className={styles.body}>
        <div className={styles.preview}>
          <canvas ref={canvasRef} className={styles.canvas} />
          {preview.kind === "ready" ? (
            <div className={styles.viewBar}>
              <span className={styles.viewHint}>Scroll to zoom, drag to move</span>
              <button type="button" className={styles.resetView} onClick={resetView}>
                Reset view
              </button>
            </div>
          ) : (
            !error && (
              <p className={preview.kind === "error" ? styles.previewError : styles.status}>
                {preview.kind === "error" ? preview.message : "Loading…"}
              </p>
            )
          )}
        </div>

        <div className={styles.panels}>
          {error ? (
            <p className={styles.error}>{error}</p>
          ) : (
            data && <MappingSummary mapping={data.mapping} warnings={data.warnings} />
          )}
          {preview.kind === "ready" && (
            <PreviewControls stage={preview.stage} manifest={preview.manifest} />
          )}
        </div>
      </div>
    </main>
  );
}
