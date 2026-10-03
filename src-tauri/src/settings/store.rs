use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, PoisonError},
    time::Duration,
};

use tokio::sync::watch;
use tracing::warn;

use super::Settings;

const FILE_NAME: &str = "config.json";

/// Window moves arrive many times per second while dragging; coalesce them into one write.
const SAVE_DEBOUNCE: Duration = Duration::from_millis(500);

#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error("settings file I/O failed: {0}")]
    Io(#[from] io::Error),
    #[error("settings could not be serialised: {0}")]
    Json(#[from] serde_json::Error),
}

/// In-memory settings with debounced, atomic persistence. Reads never touch the disk.
pub struct SettingsStore {
    path: PathBuf,
    tx: watch::Sender<Settings>,
    /// Keeps the background writer and `flush` from interleaving on the temp file.
    write_lock: Arc<Mutex<()>>,
}

impl SettingsStore {
    /// Loads settings from `dir` (defaults if the file is missing or invalid) and starts the
    /// background writer. Must be called from within the Tauri runtime.
    pub fn open(dir: &Path) -> Self {
        let path = dir.join(FILE_NAME);
        let (tx, _) = watch::channel(load(&path));
        let store = Self {
            path,
            tx,
            write_lock: Arc::default(),
        };
        store.spawn_writer();
        store
    }

    pub fn get(&self) -> Settings {
        self.tx.borrow().clone()
    }

    /// Applies `f` and schedules a save if anything changed.
    pub fn update(&self, f: impl FnOnce(&mut Settings)) {
        self.tx.send_if_modified(|settings| {
            let before = settings.clone();
            f(settings);
            *settings != before
        });
    }

    /// Writes the current settings immediately, so a pending debounced save is not lost on
    /// quit. Blocks; call it off the async runtime.
    pub fn flush(&self) -> Result<(), SettingsError> {
        let settings = self.get();
        let _guard = self
            .write_lock
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        write(&self.path, &settings)
    }

    fn spawn_writer(&self) {
        let mut rx = self.tx.subscribe();
        let path = self.path.clone();
        let lock = Arc::clone(&self.write_lock);
        tauri::async_runtime::spawn(async move {
            while rx.changed().await.is_ok() {
                tokio::time::sleep(SAVE_DEBOUNCE).await;
                let settings = rx.borrow_and_update().clone();
                let path = path.clone();
                let lock = Arc::clone(&lock);
                let result = tauri::async_runtime::spawn_blocking(move || {
                    let _guard = lock.lock().unwrap_or_else(PoisonError::into_inner);
                    write(&path, &settings)
                })
                .await;
                match result {
                    Ok(Ok(())) => {}
                    Ok(Err(error)) => warn!(%error, "failed to save settings"),
                    Err(error) => warn!(%error, "settings save task failed"),
                }
            }
        });
    }
}

fn load(path: &Path) -> Settings {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Settings::default(),
        Err(error) => {
            warn!(%error, "could not read settings, using defaults");
            return Settings::default();
        }
    };
    match serde_json::from_str::<Settings>(&text) {
        Ok(settings) => settings.sanitized(),
        Err(error) => {
            // Keep the broken file for the user instead of overwriting it on the next save.
            warn!(%error, "settings file is invalid, moving it aside and using defaults");
            if let Err(error) = fs::rename(path, path.with_extension("json.corrupt")) {
                warn!(%error, "could not move the invalid settings file aside");
            }
            Settings::default()
        }
    }
}

/// Writes via a temp file and rename so a crash mid-write never leaves a truncated file.
fn write(path: &Path, settings: &Settings) -> Result<(), SettingsError> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(settings)?)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::WindowPosition;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "itsumo-desk-settings-{}-{name}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).expect("create temp dir");
            Self(dir)
        }

        fn config(&self) -> PathBuf {
            self.0.join(FILE_NAME)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn missing_file_gives_defaults() {
        let dir = TempDir::new("missing");
        let settings = load(&dir.config());
        assert_eq!(settings, Settings::default());
        assert!(settings.companion.always_on_top);
        assert_eq!(settings.companion.position, None);
    }

    #[test]
    fn partial_file_fills_in_defaults_and_ignores_unknown_fields() {
        let dir = TempDir::new("partial");
        fs::write(
            dir.config(),
            r#"{"companion":{"alwaysOnTop":false},"fromTheFuture":1}"#,
        )
        .expect("write config");

        let settings = load(&dir.config());
        assert!(!settings.companion.always_on_top);
        assert_eq!(settings.companion.position, None);
    }

    #[test]
    fn out_of_range_values_are_clamped_on_load() {
        let dir = TempDir::new("clamped");
        fs::write(
            dir.config(),
            r#"{"companion":{"scale":40},"characters":{"a":{"framing":{"zoom":0,"centerY":0.5}}}}"#,
        )
        .expect("write config");

        let settings = load(&dir.config());
        assert_eq!(settings.companion.scale, crate::settings::MAX_SCALE);
        let framing = settings.characters["a"].framing.expect("framing kept");
        assert_eq!(framing.zoom, 0.25);
        // Saved before framing had a horizontal centre.
        assert_eq!(framing.center_x, 0.0);
        assert_eq!(framing.center_y, 0.5);
    }

    #[test]
    fn invalid_file_is_moved_aside() {
        let dir = TempDir::new("invalid");
        fs::write(dir.config(), "{ not json").expect("write config");

        assert_eq!(load(&dir.config()), Settings::default());
        assert!(!dir.config().exists());
        let kept = fs::read_to_string(dir.0.join("config.json.corrupt")).expect("corrupt copy");
        assert_eq!(kept, "{ not json");
    }

    #[test]
    fn write_then_load_round_trips() {
        let dir = TempDir::new("round-trip");
        let mut settings = Settings::default();
        settings.companion.position = Some(WindowPosition { x: -1200, y: 340 });
        settings.companion.always_on_top = false;

        write(&dir.config(), &settings).expect("write settings");
        assert_eq!(load(&dir.config()), settings);
        assert!(!dir.0.join("config.json.tmp").exists());
    }
}
