import { useEffect, useState } from "react";
import { type AppInfo, commands } from "@/ipc";
import { syncCharactersStore } from "@/stores/characters";
import { CharactersSection } from "@/windows/settings/CharactersSection";
import { MappingView } from "@/windows/settings/MappingView";
import styles from "./SettingsApp.module.css";

export function SettingsApp() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  // The character whose mapping is open, in place of the main page.
  const [mappingFor, setMappingFor] = useState<string | null>(null);

  useEffect(() => {
    commands.appInfo().then(setInfo);
  }, []);

  useEffect(() => syncCharactersStore(), []);

  if (mappingFor !== null) {
    return <MappingView id={mappingFor} onBack={() => setMappingFor(null)} />;
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
        {info && (
          <p className={styles.version}>
            {info.name} v{info.version}
          </p>
        )}
      </header>
      <CharactersSection onEditMapping={setMappingFor} />
    </main>
  );
}
