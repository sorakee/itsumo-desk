import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Stage } from "@/live2d/stage";
import { useChatStore } from "@/stores/chat";
import { type BubblePlacement, placeBubble } from "@/windows/companion/bubblePlacement";
import styles from "./SpeechBubble.module.css";

/** Room kept clear at the bottom while the chat input is open; see `ChatInput.module.css`. */
const INPUT_RESERVE = 56;

interface SpeechBubbleProps {
  /** Places the bubble by the model's face; without one it sits at the top. */
  stage: Stage | null;
}

/**
 * The companion's subtitle (D57): one segment at a time beside the head, or a typing
 * bubble while a reply is on its way. Never a hit region, so clicks pass through it.
 */
export function SpeechBubble({ stage }: SpeechBubbleProps) {
  const subtitle = useChatStore((state) => state.subtitle);
  const waiting = useChatStore((state) => state.waiting);
  const inputOpen = useChatStore((state) => state.inputOpen);
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<BubblePlacement | null>(null);
  const [resized, setResized] = useState(0);
  const visible = subtitle !== null || waiting;

  useEffect(() => {
    if (!visible) return;
    const onResize = () => setResized((count) => count + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [visible]);

  // Measured and placed before paint, so a new segment never shows in the old spot. The
  // face is read only here: the framing rarely changes while a reply is on screen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: each listed value changes the bubble's size or the room it has.
  useLayoutEffect(() => {
    const bubble = ref.current;
    if (!bubble) return;
    setPlacement(
      placeBubble(
        stage?.face,
        { width: bubble.offsetWidth, height: bubble.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        inputOpen ? INPUT_RESERVE : 0,
      ),
    );
  }, [stage, subtitle, waiting, inputOpen, resized]);

  if (!visible) return null;

  const style = {
    left: placement?.left ?? 0,
    top: placement?.top ?? 0,
    visibility: placement ? "visible" : "hidden",
    "--tail-x": `${placement?.tailX ?? 0}px`,
  } as CSSProperties;

  return (
    <div ref={ref} className={styles.bubble} style={style} aria-live="polite">
      {subtitle ? (
        <p key={`${subtitle.turn}:${subtitle.index}`} className={styles.text}>
          {subtitle.text}
        </p>
      ) : (
        <span className={styles.typing} role="img" aria-label="Typing">
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.dot} />
        </span>
      )}
    </div>
  );
}
