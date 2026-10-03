import { useEffect, useState } from "react";
import { type AppInfo, commands } from "@/ipc";
import styles from "./SettingsApp.module.css";

export function SettingsApp() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    commands.appInfo().then(setInfo);
  }, []);

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
      <p className={styles.empty}>Nothing to configure yet.</p>
    </main>
  );
}
