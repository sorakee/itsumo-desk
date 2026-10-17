import { useEffect, useState } from "react";
import { type AppInfo, commands } from "@/ipc";
import { syncCharactersStore } from "@/stores/characters";
import { syncProvidersStore } from "@/stores/providers";
import { CharactersSection } from "@/windows/settings/CharactersSection";
import { MappingView } from "@/windows/settings/MappingView";
import { ProvidersSection } from "@/windows/settings/ProvidersSection";
import { SettingsNav, type SettingsPage } from "@/windows/settings/SettingsNav";
import styles from "./SettingsApp.module.css";

export function SettingsApp() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [page, setPage] = useState<SettingsPage>("characters");
  // The character whose mapping is open, in place of the main page, and whether it was
  // just imported.
  const [mappingFor, setMappingFor] = useState<{ id: string; imported: boolean } | null>(null);

  useEffect(() => {
    commands.appInfo().then(setInfo);
  }, []);

  useEffect(() => syncCharactersStore(), []);
  useEffect(() => syncProvidersStore(), []);

  if (mappingFor !== null) {
    return (
      <MappingView
        id={mappingFor.id}
        imported={mappingFor.imported}
        onBack={() => setMappingFor(null)}
      />
    );
  }

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <h1 className={styles.title}>Settings</h1>
        <SettingsNav page={page} onChange={setPage} />
        {info && (
          <p className={styles.version}>
            {info.name} v{info.version}
          </p>
        )}
      </aside>
      <main className={styles.page}>
        {page === "characters" && (
          <CharactersSection onEditMapping={(id, imported) => setMappingFor({ id, imported })} />
        )}
        {page === "providers" && <ProvidersSection />}
      </main>
    </div>
  );
}
