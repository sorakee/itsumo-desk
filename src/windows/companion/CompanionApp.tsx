import { type MouseEvent, useState } from "react";
import { startWindowDrag } from "@/ipc";
import { devModelSource } from "@/windows/companion/devModel";
import { ModelStage, type StageStatus } from "@/windows/companion/ModelStage";
import styles from "./CompanionApp.module.css";

const source = devModelSource();

// Until hit regions exist, the whole window is a drag handle.
function onMouseDown(event: MouseEvent) {
  if (event.button === 0) {
    void startWindowDrag();
  }
}

function statusText(status: StageStatus): string | null {
  switch (status.kind) {
    case "ready":
    case "loading":
      return null;
    case "empty":
      return "No character loaded";
    case "error":
      return "Could not load the character";
  }
}

export function CompanionApp() {
  const [status, setStatus] = useState<StageStatus>({ kind: "loading" });
  const text = statusText(status);

  return (
    <main className={styles.stage} onMouseDown={onMouseDown}>
      <ModelStage source={source} onStatusChange={setStatus} />
      {text && (
        <div className={styles.placeholder}>
          <p className={styles.status}>{text}</p>
          {status.kind === "error" && <p className={styles.detail}>{status.message}</p>}
        </div>
      )}
    </main>
  );
}
