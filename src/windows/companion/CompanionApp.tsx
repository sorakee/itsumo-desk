import { useState } from "react";
import { devModelSource } from "@/windows/companion/devModel";
import { HIT_REGION_ATTRIBUTE } from "@/windows/companion/interaction";
import { ModelStage, type StageStatus } from "@/windows/companion/ModelStage";
import styles from "./CompanionApp.module.css";

const source = devModelSource();

// Makes the placeholder catch clicks (and drag the window) like the model does.
const hitRegion = { [HIT_REGION_ATTRIBUTE]: true };

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
    <main className={styles.stage}>
      <ModelStage source={source} onStatusChange={setStatus} />
      {text && (
        <div className={styles.placeholder} {...hitRegion}>
          <p className={styles.status}>{text}</p>
          {status.kind === "error" && <p className={styles.detail}>{status.message}</p>}
        </div>
      )}
    </main>
  );
}
