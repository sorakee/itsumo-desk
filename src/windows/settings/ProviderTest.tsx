import { useEffect, useRef, useState } from "react";
import { type ProviderSummary, type TestReport, testProvider } from "@/ipc";
import { errorMessage } from "@/shared/errorMessage";
import { Button } from "@/windows/settings/Button";
import styles from "./ProviderTest.module.css";

type TestState =
  | { step: "idle" }
  | { step: "running"; text: string; thinking: boolean }
  | { step: "done"; text: string; report: TestReport }
  | { step: "failed"; text: string; message: string };

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** "Test connection": streams a one-sentence reply from the profile's model. */
export function ProviderTest({ provider }: { provider: ProviderSummary }) {
  const [state, setState] = useState<TestState>({ step: "idle" });
  const [waited, setWaited] = useState(0);
  // A test still streaming when the card unmounts must not set state afterwards.
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const running = state.step === "running";
  const waiting = running && state.text === "" && !state.thinking;
  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    const timer = setInterval(() => setWaited(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => {
      clearInterval(timer);
      setWaited(0);
    };
  }, [waiting]);

  function start() {
    let text = "";
    let thinking = false;
    setState({ step: "running", text, thinking });
    testProvider(provider.id, (event) => {
      if (!mounted.current) return;
      if (event.kind === "thinking") thinking = true;
      else text += event.text;
      setState({ step: "running", text, thinking });
    }).then(
      (report) => {
        if (mounted.current) setState({ step: "done", text, report });
      },
      (error: unknown) => {
        if (mounted.current) setState({ step: "failed", text, message: errorMessage(error) });
      },
    );
  }

  return (
    <div className={styles.test}>
      <Button onClick={start} disabled={running}>
        {running ? "Testing…" : "Test connection"}
      </Button>
      {state.step !== "idle" && (
        <div className={styles.result} aria-live="polite">
          {state.text !== "" && <p className={styles.reply}>{state.text}</p>}
          {state.step === "running" && state.text === "" && (
            <p className={styles.status}>
              {state.thinking
                ? "The model is thinking…"
                : `Waiting for a reply${waited > 0 ? ` (${waited} s)` : "…"}`}
            </p>
          )}
          {state.step === "done" && (
            <p className={styles.status}>
              {state.text === "" ? "Connected, but the reply was empty. " : ""}
              First token after {seconds(state.report.firstTokenMs)}
              {state.report.truncated ? "; stopped reading early." : "."}
            </p>
          )}
          {state.step === "failed" && <p className={styles.error}>{state.message}</p>}
        </div>
      )}
    </div>
  );
}
