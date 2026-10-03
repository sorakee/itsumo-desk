interface ImportMetaEnv {
  /** Dev only: model3.json path under `models/` to load instead of the default sample. */
  readonly VITE_DEV_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
