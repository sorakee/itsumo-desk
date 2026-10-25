import { useEffect, useMemo, useState } from "react";
import type { ActiveCharacter } from "@/ipc";
import type { ModelSource } from "@/live2d/model";
import type { Stage } from "@/live2d/stage";
import { syncCharactersStore, useCharactersStore } from "@/stores/characters";
import { useChatStore } from "@/stores/chat";
import { syncCompanionStore } from "@/stores/companion";
import { useMenuStore } from "@/stores/menu";
import { ChatInput } from "@/windows/companion/ChatInput";
import { CompanionMenu } from "@/windows/companion/CompanionMenu";
import { startChat } from "@/windows/companion/chat";
import { devModelSource } from "@/windows/companion/devModel";
import { HIT_REGION_ATTRIBUTE } from "@/windows/companion/interaction";
import { ModelStage, type StageStatus } from "@/windows/companion/ModelStage";
import { SpeechBubble } from "@/windows/companion/SpeechBubble";
import styles from "./CompanionApp.module.css";

const devSource = devModelSource();

/** The active character's model; the dev sample when none is active (D42). */
function sourceOf(active: ActiveCharacter | null | undefined): ModelSource | null | undefined {
  if (active === undefined) return undefined;
  if (active === null) return devSource;
  return { id: active.id, url: active.modelUrl, extras: active.extras };
}

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
  const [stage, setStage] = useState<Stage | null>(null);
  const chatOpen = useChatStore((state) => state.inputOpen);
  const menuAnchor = useMenuStore((state) => state.anchor);
  const active = useCharactersStore((state) => state.active);
  const mapping = useCharactersStore((state) => state.mapping);
  const source = useMemo(() => sourceOf(active), [active]);
  const text = statusText(status);

  useEffect(() => syncCompanionStore(), []);
  useEffect(() => syncCharactersStore(), []);
  useEffect(() => startChat(), []);

  return (
    <main className={styles.stage}>
      <ModelStage source={source} mapping={mapping} onStatusChange={setStatus} onStage={setStage} />
      {text && (
        <div className={styles.placeholder} {...hitRegion}>
          <p className={styles.status}>{text}</p>
          {status.kind === "error" && <p className={styles.detail}>{status.message}</p>}
          {status.kind === "empty" && (
            <p className={styles.detail}>Right-click here and open Settings to import one.</p>
          )}
        </div>
      )}
      <SpeechBubble stage={stage} />
      {chatOpen && <ChatInput />}
      {menuAnchor && <CompanionMenu key={`${menuAnchor.x},${menuAnchor.y}`} anchor={menuAnchor} />}
    </main>
  );
}
