import { useEffect } from "react";
import type { ModelManifest } from "@/live2d/manifest";
import type { Stage } from "@/live2d/stage";
import { MappingEditor } from "@/windows/settings/MappingEditor";
import { PreviewControls } from "@/windows/settings/PreviewControls";
import type { MappingEditing } from "@/windows/settings/useCharacterMapping";
import { usePreviewActions } from "@/windows/settings/usePreviewActions";

interface MappingPanelsProps {
  stage: Stage;
  manifest: ModelManifest;
  editing: MappingEditing;
}

/** The mapping editor and the preview buttons, once the preview has the model loaded. */
export function MappingPanels({ stage, manifest, editing }: MappingPanelsProps) {
  const actions = usePreviewActions(stage, manifest);
  const { mapping } = editing;

  // The preview plays the mapping as edited, e.g. its idle loop follows the idle slot.
  useEffect(() => {
    stage.setMapping(mapping);
  }, [stage, mapping]);

  return (
    <>
      <MappingEditor
        mapping={mapping}
        customized={editing.customized}
        warnings={editing.warnings}
        saveError={editing.saveError}
        manifest={manifest}
        actions={actions}
        onChange={editing.save}
        onReset={editing.reset}
      />
      <PreviewControls manifest={manifest} actions={actions} />
    </>
  );
}
