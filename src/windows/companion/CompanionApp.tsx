import { type MouseEvent, useEffect, useState } from "react";
import { type AppInfo, commands, startWindowDrag } from "@/ipc";
import styles from "./CompanionApp.module.css";

// Until the model and its hit regions exist, the whole window is a drag handle and the
// placeholder outlines the window bounds.
function onMouseDown(event: MouseEvent) {
  if (event.button === 0) {
    void startWindowDrag();
  }
}

export function CompanionApp() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    commands.appInfo().then(setInfo);
  }, []);

  return (
    <main className={styles.stage} onMouseDown={onMouseDown}>
      <div className={styles.placeholder}>
        <h1 className={styles.name}>{info?.name ?? "Itsumo Desk"}</h1>
        {info && <p className={styles.version}>v{info.version}</p>}
        <p className={styles.hint}>Drag to move</p>
      </div>
    </main>
  );
}
