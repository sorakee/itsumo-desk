import type { Target } from "@/ipc";
import { Icon } from "@/shared/Icon";
import type { PreviewActions } from "@/windows/settings/usePreviewActions";
import styles from "./PreviewButton.module.css";

interface PreviewButtonProps {
  /** Undefined when nothing is mapped; the button is then disabled. */
  target: Target | undefined;
  actions: PreviewActions;
  /** What is previewed, for the accessible label. */
  label: string;
}

/** Plays a slot's or entry's target on the preview; expressions and doze toggle. */
export function PreviewButton({ target, actions, label }: PreviewButtonProps) {
  return (
    <button
      type="button"
      className={styles.button}
      aria-label={`Preview ${label}`}
      title="Preview"
      disabled={!target}
      aria-pressed={target && actions.pressed(target)}
      onClick={() => target && actions.playTarget(target)}
    >
      <Icon name="play" className={styles.icon} />
    </button>
  );
}
