import { type KeyboardEvent, useId, useRef, useState } from "react";
import {
  type PresetInfo,
  type ProviderSummary,
  type ProviderUpdate,
  providerModels,
  updateProvider,
} from "@/ipc";
import { errorMessage } from "@/shared/errorMessage";
import { Button } from "@/windows/settings/Button";
import { MAX_NAME_LENGTH } from "@/windows/settings/NameInput";
import { ProviderKeyField } from "@/windows/settings/ProviderKeyField";
import { ProviderTest } from "@/windows/settings/ProviderTest";
import styles from "./ProviderCard.module.css";

interface ProviderCardProps {
  provider: ProviderSummary;
  /** Undefined until the presets load. */
  preset: PresetInfo | undefined;
  onUseForChat: () => void;
  onRemove: () => void;
}

/** Reads every field of the card's form, so one save never reverts another field's edit. */
function readForm(form: HTMLFormElement): ProviderUpdate {
  const field = (name: string) => {
    const element = form.elements.namedItem(name);
    return element instanceof HTMLInputElement ? element : null;
  };
  return {
    name: field("name")?.value ?? "",
    baseUrl: field("baseUrl")?.value ?? "",
    model: field("model")?.value ?? "",
    capabilities: {
      tools: field("tools")?.checked ?? false,
      vision: field("vision")?.checked ?? false,
    },
  };
}

function unchanged(update: ProviderUpdate, provider: ProviderSummary): boolean {
  return (
    update.name.trim() === provider.name &&
    update.baseUrl.trim() === provider.baseUrl &&
    update.model.trim() === provider.model &&
    update.capabilities.tools === provider.capabilities.tools &&
    update.capabilities.vision === provider.capabilities.vision
  );
}

/** Enter saves by leaving the field; Escape puts the saved value back first. */
function leaveOnEnterOrEscape(event: KeyboardEvent<HTMLInputElement>, saved: string) {
  if (event.key === "Escape") {
    event.currentTarget.value = saved;
    event.currentTarget.blur();
  } else if (event.key === "Enter") {
    event.preventDefault();
    event.currentTarget.blur();
  }
}

/** One provider profile. Fields save when they lose focus, like the rest of Settings. */
export function ProviderCard({ provider, preset, onUseForChat, onRemove }: ProviderCardProps) {
  const form = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // Fetched on first focus of the model field, then kept until the base URL changes.
  const [models, setModels] = useState<{ baseUrl: string; names: string[] } | null>(null);
  const id = useId();

  function save() {
    if (form.current === null) return;
    const update = readForm(form.current);
    if (unchanged(update, provider)) return;
    setError(null);
    updateProvider(provider.id, update).catch((reason: unknown) => setError(errorMessage(reason)));
  }

  function loadModels() {
    if (models?.baseUrl === provider.baseUrl || provider.baseUrl === "") return;
    const baseUrl = provider.baseUrl;
    setModels({ baseUrl, names: [] });
    providerModels(provider.id)
      .then((names) => setModels({ baseUrl, names }))
      // Suggestions only: the field works without them, and Test connection explains failures.
      .catch((reason: unknown) => console.warn("failed to list models", reason));
  }

  // Keyed by the saved value, so a field shows what the core stored (trimmed, normalised)
  // once a save lands, and keeps what the user typed when a save is refused.
  const textField = (name: "name" | "baseUrl" | "model", saved: string) => ({
    key: saved,
    name,
    defaultValue: saved,
    spellCheck: false,
    autoComplete: "off",
    onBlur: save,
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => leaveOnEnterOrEscape(event, saved),
  });

  return (
    <li className={styles.card}>
      <form ref={form} className={styles.form} onSubmit={(event) => event.preventDefault()}>
        <div className={styles.top}>
          <input
            {...textField("name", provider.name)}
            className={styles.name}
            aria-label="Profile name"
            maxLength={MAX_NAME_LENGTH}
          />
          {provider.main && <span className={styles.badge}>Used for chat</span>}
          <div className={styles.actions}>
            {confirming ? (
              <>
                <span className={styles.confirm}>Remove it and its key?</span>
                <Button
                  tone="danger"
                  onClick={() => {
                    setConfirming(false);
                    onRemove();
                  }}
                >
                  Remove
                </Button>
                <Button onClick={() => setConfirming(false)}>Keep</Button>
              </>
            ) : (
              <>
                {!provider.main && <Button onClick={onUseForChat}>Use for chat</Button>}
                <Button onClick={() => setConfirming(true)}>Remove</Button>
              </>
            )}
          </div>
        </div>
        {preset && <p className={styles.preset}>{preset.label}</p>}

        <div className={styles.fields}>
          <label className={styles.label} htmlFor={`${id}-url`}>
            Base URL
          </label>
          <input
            {...textField("baseUrl", provider.baseUrl)}
            id={`${id}-url`}
            className={styles.input}
            placeholder="https://…/v1"
          />

          <label className={styles.label} htmlFor={`${id}-model`}>
            Model
          </label>
          <input
            {...textField("model", provider.model)}
            id={`${id}-model`}
            className={styles.input}
            placeholder={preset?.modelHint}
            list={`${id}-models`}
            onFocus={loadModels}
          />
          <datalist id={`${id}-models`}>
            {models?.names.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>

          <span className={styles.label}>API key</span>
          <ProviderKeyField provider={provider} needsKey={preset?.needsKey ?? true} />

          <span className={styles.label}>Supports</span>
          <div className={styles.capabilities}>
            <label className={styles.option}>
              <input
                key={String(provider.capabilities.tools)}
                type="checkbox"
                name="tools"
                className={styles.checkbox}
                defaultChecked={provider.capabilities.tools}
                onChange={save}
              />
              Tool calling
            </label>
            <label className={styles.option}>
              <input
                key={String(provider.capabilities.vision)}
                type="checkbox"
                name="vision"
                className={styles.checkbox}
                defaultChecked={provider.capabilities.vision}
                onChange={save}
              />
              Images
            </label>
            <span className={styles.hint}>
              Later features use these; untick what the model lacks.
            </span>
          </div>
        </div>
      </form>

      {provider.keyOverPlainHttp && (
        <p className={styles.warning}>
          This server is reached over plain HTTP, so the key crosses the network unencrypted. Use
          https:// if the server supports it.
        </p>
      )}
      {error && <p className={styles.error}>{error}</p>}
      <ProviderTest provider={provider} />
    </li>
  );
}
