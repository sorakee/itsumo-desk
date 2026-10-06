import { useState } from "react";
import { removeCharacter, renameCharacter, setActiveCharacter, setCharacterFavorite } from "@/ipc";
import { errorMessage } from "@/shared/errorMessage";
import { useCharactersStore } from "@/stores/characters";
import { Button } from "@/windows/settings/Button";
import { CharacterRow } from "@/windows/settings/CharacterRow";
import { ImportDialog } from "@/windows/settings/ImportDialog";
import { useCharacterImport } from "@/windows/settings/useCharacterImport";
import styles from "./CharactersSection.module.css";

interface CharactersSectionProps {
  onEditMapping: (id: string) => void;
}

/** Installed characters: import, switch, rename, favourite, map, remove. */
export function CharactersSection({ onEditMapping }: CharactersSectionProps) {
  const characters = useCharactersStore((state) => state.characters);
  const activeId = useCharactersStore((state) => state.active?.id);
  const { state, start, rename, install, cancel } = useCharacterImport();
  const [actionError, setActionError] = useState<string | null>(null);
  const importing = state.step !== "idle" && state.step !== "failed";

  /** Runs `action`, showing its error if it fails. Resolves to whether it succeeded. */
  function run(action: () => Promise<void>): Promise<boolean> {
    setActionError(null);
    return action().then(
      () => true,
      (error: unknown) => {
        setActionError(errorMessage(error));
        return false;
      },
    );
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
                onEditMapping={() => onEditMapping(character.id)}
                onRemove={() => run(() => removeCharacter(character.id))}
                onRename={(name) => run(() => renameCharacter(character.id, name))}
                onToggleFavorite={() =>
                  run(() => setCharacterFavorite(character.id, !character.favorite))
                }
              />
            ))}
          </ul>
        ))}

      <ImportDialog state={state} onRename={rename} onInstall={install} onCancel={cancel} />
    </section>
  );
}
