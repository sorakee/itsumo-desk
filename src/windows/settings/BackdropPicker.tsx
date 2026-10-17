import { PREVIEW_BACKDROPS, type PreviewBackdrop } from "@/windows/settings/previewBackdrop";
import styles from "./BackdropPicker.module.css";

const LABELS: Record<PreviewBackdrop, string> = {
  light: "Light background",
  grey: "Grey background",
  dark: "Dark background",
};

interface BackdropPickerProps {
  value: PreviewBackdrop;
  onChange: (backdrop: PreviewBackdrop) => void;
}

/** Swatches that set the mapping preview's background. */
export function BackdropPicker({ value, onChange }: BackdropPickerProps) {
  return (
    <fieldset className={styles.swatches}>
      <legend className={styles.legend}>Preview background</legend>
      {PREVIEW_BACKDROPS.map((backdrop) => (
        <button
          key={backdrop}
          type="button"
          className={styles.swatch}
          data-backdrop={backdrop}
          aria-label={LABELS[backdrop]}
          title={LABELS[backdrop]}
          aria-pressed={backdrop === value}
          onClick={() => onChange(backdrop)}
        />
      ))}
    </fieldset>
  );
}
