import { HotkeyCard } from "@/windows/settings/HotkeyCard";
import styles from "./GeneralSection.module.css";

/** App-wide preferences: for now the chat hotkey. */
export function GeneralSection() {
  return (
    <section aria-labelledby="general-title">
      <h2 id="general-title" className={styles.title}>
        General
      </h2>
      <HotkeyCard />
    </section>
  );
}
