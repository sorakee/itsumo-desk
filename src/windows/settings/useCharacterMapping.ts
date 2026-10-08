// Loads a character's mapping for the mapping view and saves edits as they are made (D45).
// The editor shows an edit at once; saves run one after another, so the file always ends
// up with the last edit, and a failed save goes back to what was saved before.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CharacterMapping,
  characterMapping,
  type Mapping,
  resetCharacterMapping,
  saveCharacterMapping,
} from "@/ipc";
import { errorMessage } from "@/shared/errorMessage";
import { EMPTY_MAPPING } from "@/windows/settings/mappingSlots";

export interface CharacterModel {
  url: string;
  extras: CharacterMapping["extras"];
}

export interface MappingEditing {
  /** The character's model, for the preview; set once, so saves do not reload it. */
  model: CharacterModel | null;
  /** The mapping as edited, which saves may not have reached yet. */
  mapping: Mapping;
  customized: boolean;
  warnings: string[];
  /** What the core guesses from the model's names; offered, never applied by itself. */
  suggested: Mapping;
  loadError: string | null;
  saveError: string | null;
  save: (mapping: Mapping) => void;
  reset: () => void;
}

export function useCharacterMapping(id: string): MappingEditing {
  const [model, setModel] = useState<CharacterModel | null>(null);
  const [saved, setSaved] = useState<CharacterMapping | null>(null);
  const [mapping, setMapping] = useState<Mapping>(EMPTY_MAPPING);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  // Only the latest change's outcome is shown; earlier ones are already overtaken.
  const latest = useRef(0);
  const lastSaved = useRef<Mapping>(EMPTY_MAPPING);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    characterMapping(id).then(
      (loaded) => {
        if (!mounted.current) return;
        setModel({ url: loaded.modelUrl, extras: loaded.extras });
        setSaved(loaded);
        lastSaved.current = loaded.mapping ?? EMPTY_MAPPING;
        setMapping(lastSaved.current);
      },
      (failed: unknown) => {
        if (mounted.current) setLoadError(errorMessage(failed));
      },
    );
    return () => {
      mounted.current = false;
    };
  }, [id]);

  const run = useCallback((change: () => Promise<CharacterMapping>) => {
    const request = ++latest.current;
    setSaveError(null);
    queue.current = queue.current.then(change).then(
      (read) => {
        lastSaved.current = read.mapping ?? EMPTY_MAPPING;
        if (!mounted.current || request !== latest.current) return;
        setSaved(read);
        setMapping(lastSaved.current);
      },
      (failed: unknown) => {
        if (!mounted.current || request !== latest.current) return;
        setSaveError(errorMessage(failed));
        setMapping(lastSaved.current);
      },
    );
  }, []);

  const save = useCallback(
    (next: Mapping) => {
      setMapping(next);
      run(() => saveCharacterMapping(id, next));
    },
    [id, run],
  );

  const reset = useCallback(() => run(() => resetCharacterMapping(id)), [id, run]);

  return {
    model,
    mapping,
    customized: saved?.customized ?? false,
    warnings: saved?.warnings ?? [],
    suggested: saved?.suggested ?? EMPTY_MAPPING,
    loadError,
    saveError,
    save,
    reset,
  };
}
