import { useMemo, useRef } from "react";
import type { ModelSource } from "@/live2d/model";
import { Icon } from "@/shared/Icon";
import { useCharactersStore } from "@/stores/characters";
import { MappingPanels } from "@/windows/settings/MappingPanels";
import { useCharacterMapping } from "@/windows/settings/useCharacterMapping";
import { usePreviewStage } from "@/windows/settings/usePreviewStage";
import styles from "./MappingView.module.css";

interface MappingViewProps {
  id: string;
  onBack: () => void;
}

/** One character's expressions, motions and mapping editor, with a live preview. */
export function MappingView({ id, onBack }: MappingViewProps) {
  const name = useCharactersStore((state) => state.characters?.find((c) => c.id === id)?.name);
  const editing = useCharacterMapping(id);
  const { model, loadError: error } = editing;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const source = useMemo<ModelSource | undefined>(
    () => (model ? { id, url: model.url, extras: model.extras } : undefined),
    [id, model],
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
            <>
              {preview.kind === "ready" && (
                <MappingPanels
                  stage={preview.stage}
                  manifest={preview.manifest}
                  editing={editing}
                />
              )}
              {preview.kind === "error" && (
                <p className={styles.error}>The mapping can be edited once the model loads.</p>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
