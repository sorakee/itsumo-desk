import { useEffect, useState } from "react";
import { type AppInfo, commands } from "@/ipc";
import styles from "./CompanionApp.module.css";

export function CompanionApp() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    commands.appInfo().then(setInfo);
  }, []);

  return (
    <main className={styles.stage}>
      <h1 className={styles.name}>{info?.name ?? "Itsumo Desk"}</h1>
      {info && <p className={styles.version}>v{info.version}</p>}
    </main>
  );
}
