import { useEffect, useState } from "react";
import {
  addProvider,
  type Preset,
  type PresetInfo,
  providerPresets,
  removeProvider,
  setMainProvider,
} from "@/ipc";
import { errorMessage } from "@/shared/errorMessage";
import { useProvidersStore } from "@/stores/providers";
import { Button } from "@/windows/settings/Button";
import { PresetPicker } from "@/windows/settings/PresetPicker";
import { ProviderCard } from "@/windows/settings/ProviderCard";
import styles from "./ProvidersSection.module.css";

/** LLM provider profiles: add from a preset, edit, set keys, test, choose chat's. */
export function ProvidersSection() {
  const providers = useProvidersStore((state) => state.providers);
  const [presets, setPresets] = useState<PresetInfo[]>([]);
  const [picking, setPicking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    providerPresets().then(setPresets);
  }, []);

  function run(action: () => Promise<unknown>) {
    setActionError(null);
    action().catch((error: unknown) => setActionError(errorMessage(error)));
  }

  function add(preset: Preset) {
    setPicking(false);
    run(() => addProvider(preset));
  }

  return (
    <section aria-labelledby="providers-title">
      <div className={styles.header}>
        <div>
          <h2 id="providers-title" className={styles.title}>
            Providers
          </h2>
          <p className={styles.hint}>
            The language models the companion talks with: a cloud service with your API key, or a
            server on your computer. Keys stay in Windows Credential Manager.
          </p>
        </div>
        <Button tone="primary" onClick={() => setPicking((open) => !open)} aria-expanded={picking}>
          Add provider
        </Button>
      </div>

      {picking && (
        <PresetPicker presets={presets} onPick={add} onCancel={() => setPicking(false)} />
      )}
      {actionError && <p className={styles.error}>{actionError}</p>}

      {providers !== undefined && providers.length === 0 && !picking && (
        <p className={styles.empty}>No providers yet. Add one to start chatting.</p>
      )}
      {providers !== undefined && providers.length > 0 && (
        <ul className={styles.list}>
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              preset={presets.find((info) => info.preset === provider.preset)}
              onUseForChat={() => run(() => setMainProvider(provider.id))}
              onRemove={() => run(() => removeProvider(provider.id))}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
