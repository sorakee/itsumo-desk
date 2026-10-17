import styles from "./SettingsNav.module.css";

export type SettingsPage = "characters" | "providers";

const PAGES: { page: SettingsPage; label: string }[] = [
  { page: "characters", label: "Characters" },
  { page: "providers", label: "Providers" },
];

interface SettingsNavProps {
  page: SettingsPage;
  onChange: (page: SettingsPage) => void;
}

/** The settings window's page list. */
export function SettingsNav({ page, onChange }: SettingsNavProps) {
  return (
    <nav aria-label="Settings pages">
      <ul className={styles.list}>
        {PAGES.map((entry) => (
          <li key={entry.page}>
            <button
              type="button"
              className={styles.item}
              aria-current={entry.page === page ? "page" : undefined}
              onClick={() => onChange(entry.page)}
            >
              {entry.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
