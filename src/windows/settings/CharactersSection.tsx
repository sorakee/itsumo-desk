import { useEffect, useState } from "react";
import { removeCharacter, setActiveCharacter } from "@/ipc";
import { errorMessage } from "@/shared/errorMessage";
import { syncCharactersStore, useCharactersStore } from "@/stores/characters";
import { Button } from "@/windows/settings/Button";
import { CharacterRow } from "@/windows/settings/CharacterRow";
import { ImportDialog } from "@/windows/settings/ImportDialog";
import { useCharacterImport } from "@/windows/settings/useCharacterImport";
import styles from "./CharactersSection.module.css";

/** Installed characters: import, switch, remove. */
export function CharactersSection() {
  const characters = useCharactersStore((state) => state.characters);
  const activeId = useCharactersStore((state) => state.active?.id);
  const { state, start, install, cancel } = useCharacterImport();
  const [actionError, setActionError] = useState<string | null>(null);
  const importing = state.step !== "idle" && state.step !== "failed";

  useEffect(() => syncCharactersStore(), []);

  function run(action: () => Promise<void>) {
    setActionError(null);
    action().catch((error: unknown) => setActionError(errorMessage(error)));
  }

  return (
    <section className={styles.section} aria-labelledby="characters-title">
      <div className={styles.header}>
        <div>
          <h2 id="characters-title" className={styles.title}>
            Characters
          </h2>
          <p className={styles.hint}>
            Import a character pack or a Live2D model: a folder, a .zip or a .model3.json.
          </p>
        </div>
        <div className={styles.importButtons}>
          <Button onClick={() => start("folder")} disabled={importing}>
            Import folder…
          </Button>
          <Button tone="primary" onClick={() => start("file")} disabled={importing}>
            {state.step === "picking" ? "Importing…" : "Import file…"}
          </Button>
        </div>
      </div>

      {actionError && <p className={styles.error}>{actionError}</p>}

      {characters !== undefined &&
        (characters.length === 0 ? (
          <p className={styles.empty}>No characters yet.</p>
        ) : (
          <ul className={styles.list}>
            {characters.map((character) => (
              <CharacterRow
                key={character.id}
                character={character}
                active={character.id === activeId}
                disabled={importing}
                onActivate={() => run(() => setActiveCharacter(character.id))}
                onRemove={() => run(() => removeCharacter(character.id))}
              />
            ))}
          </ul>
        ))}

      <ImportDialog state={state} onInstall={install} onCancel={cancel} />
    </section>
  );
}
