// The import flow (D42): the core stages and validates the pick, this window builds the
// model's manifest (only the Cubism Core can read a moc), the core checks the mapping
// against it, and the user confirms before anything is installed.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelImport,
  commitImport,
  type ImportKind,
  type ImportReview,
  reviewImport,
  type StagedImport,
  stageImport,
} from "@/ipc";
import type { ModelManifest } from "@/live2d/manifest";
import { inspectModel } from "@/live2d/model";
import { errorMessage } from "@/shared/errorMessage";

export type ImportState =
  | { step: "idle" }
  /** The picker is open, or the core is copying what was picked. */
  | { step: "picking" }
  | { step: "reading"; staged: StagedImport }
  | Reviewed<"review">
  | Reviewed<"installing">
  | { step: "failed"; message: string };

interface Reviewed<Step extends string> {
  step: Step;
  staged: StagedImport;
  manifest: ModelManifest;
  review: ImportReview;
  /** What the user typed for the character's name, prefilled from the review. */
  name: string;
}

export interface CharacterImport {
  state: ImportState;
  start: (kind: ImportKind) => void;
  rename: (name: string) => void;
  install: () => void;
  cancel: () => void;
}

function warnCancelFailed(error: unknown) {
  console.warn("failed to discard a staged import", error);
}

export function useCharacterImport(): CharacterImport {
  const [state, setState] = useState<ImportState>({ step: "idle" });
  // The staged import the core is holding for this window, discarded if the user cancels
  // or the window closes mid-import (the core also clears staging on startup).
  const token = useRef<string | null>(null);
  const flow = useRef<AbortController | null>(null);

  const discard = useCallback(() => {
    flow.current?.abort();
    flow.current = null;
    if (token.current) {
      cancelImport(token.current).catch(warnCancelFailed);
      token.current = null;
    }
  }, []);

  useEffect(() => discard, [discard]);

  const start = useCallback(
    (kind: ImportKind) => {
      discard();
      const controller = new AbortController();
      flow.current = controller;
      setState({ step: "picking" });
      (async () => {
        const staged = await stageImport(kind);
        if (controller.signal.aborted) {
          if (staged) cancelImport(staged.token).catch(warnCancelFailed);
          return;
        }
        if (!staged) {
          setState({ step: "idle" });
          return;
        }
        token.current = staged.token;
        setState({ step: "reading", staged });
        const source = { id: staged.character.id, url: staged.modelUrl, extras: staged.extras };
        const manifest = await inspectModel(source, controller.signal);
        const review = await reviewImport(staged.token, manifest);
        controller.signal.throwIfAborted();
        setState({ step: "review", staged, manifest, review, name: review.name });
      })().catch((error: unknown) => {
        if (controller.signal.aborted) return;
        discard();
        setState({ step: "failed", message: errorMessage(error) });
      });
    },
    [discard],
  );

  const install = useCallback(() => {
    if (state.step !== "review") return;
    const { staged, review, name } = state;
    setState({ ...state, step: "installing" });
    // The core consumes the staged import whether or not the commit succeeds.
    token.current = null;
    commitImport(staged.token, review.replaces !== null, name).then(
      () => setState({ step: "idle" }),
      (error: unknown) => setState({ step: "failed", message: errorMessage(error) }),
    );
  }, [state]);

  const rename = useCallback((name: string) => {
    setState((current) => (current.step === "review" ? { ...current, name } : current));
  }, []);

  const cancel = useCallback(() => {
    discard();
    setState({ step: "idle" });
  }, [discard]);

  return { state, start, rename, install, cancel };
}
