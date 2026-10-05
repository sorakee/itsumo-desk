//! Character packs (D17, D42): import, validation, storage, and which one is active.

mod import;
mod library;
mod manifest;
mod mapping;
mod model3;
mod names;
mod pack;
mod paths;
mod protocol;

use std::io;

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_specta::Event;
use tracing::warn;

pub use library::{is_valid_token, CharacterLibrary};
pub use manifest::ModelManifest;
pub use names::display_name;
pub use pack::ModelExtras;
pub use paths::is_valid_id;
pub use protocol::{handle as handle_protocol, SCHEME};

use crate::{
    events::{ActiveCharacterChanged, CharactersChanged},
    settings::SettingsStore,
};

#[derive(Debug, thiserror::Error)]
pub enum CharacterError {
    #[error("could not read or write {what}: {source}")]
    Io { what: String, source: io::Error },
    #[error("{0}")]
    InvalidPack(String),
    #[error("{0}")]
    InvalidModel(String),
    #[error("{0}")]
    NotFound(String),
    #[error("pick a folder, a .zip or a .model3.json")]
    Unsupported,
    #[error("the pack is larger than Itsumo Desk accepts (2 GB or 10,000 files)")]
    TooLarge,
    #[error("the zip could not be read: {0}")]
    Zip(String),
    #[error("no installed character has the id {0}")]
    UnknownCharacter(String),
    #[error("this import is no longer available; start it again")]
    UnknownImport,
    #[error("a character with the id {0} is already installed")]
    Conflict(String),
    #[error("{0}")]
    InvalidName(&'static str),
    #[error("background task failed: {0}")]
    Task(String),
}

impl CharacterError {
    fn io(what: &str, source: io::Error) -> Self {
        Self::Io {
            what: what.to_owned(),
            source,
        }
    }
}

/// An installed character, as listed in the settings window.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CharacterSummary {
    pub id: String,
    /// The user's alias if there is one, else the pack's name (D44).
    pub name: String,
    /// The name in the pack's `character.json`.
    pub pack_name: String,
    pub favorite: bool,
    pub author: String,
    pub license: String,
    pub icon_url: Option<String>,
}

/// What the companion needs to load the active character.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ActiveCharacter {
    pub id: String,
    /// The `model3.json`, served by the `character` URI scheme.
    pub model_url: String,
    pub extras: ModelExtras,
}

/// What to pick in the native dialog.
#[derive(Debug, Clone, Copy, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ImportKind {
    /// A pack folder or a model folder.
    Folder,
    /// A `.zip` or a `.model3.json`.
    File,
}

/// A pack copied into staging and validated, waiting for the webview to build its manifest.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StagedImport {
    pub token: String,
    pub character: CharacterSummary,
    pub model_url: String,
    pub extras: ModelExtras,
    pub warnings: Vec<String>,
}

/// What the user confirms before an import is installed.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportReview {
    pub warnings: Vec<String>,
    /// The name of the installed character this import would replace.
    pub replaces: Option<String>,
    /// The name to offer for the character: the replaced one's alias if it has one, so
    /// replacing keeps it, else the pack's name.
    pub name: String,
}

/// Runs `f` against the library on a blocking thread: every library call touches the disk.
async fn blocking<T: Send + 'static>(
    app: &AppHandle,
    f: impl FnOnce(&CharacterLibrary) -> Result<T, CharacterError> + Send + 'static,
) -> Result<T, CharacterError> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || f(&app.state::<CharacterLibrary>()))
        .await
        .map_err(|e| CharacterError::Task(e.to_string()))?
}

pub async fn list(app: &AppHandle) -> Result<Vec<CharacterSummary>, CharacterError> {
    let preferences = app.state::<SettingsStore>().get().characters;
    blocking(app, move |library| Ok(library.list(&preferences))).await
}

/// The active character, or `None` if none is set or its pack is gone.
pub async fn active(app: &AppHandle) -> Result<Option<ActiveCharacter>, CharacterError> {
    let Some(id) = app.state::<SettingsStore>().get().active_character else {
        return Ok(None);
    };
    blocking(app, move |library| Ok(library.active(&id))).await
}

async fn emit_active(app: &AppHandle) {
    let character = match active(app).await {
        Ok(character) => character,
        Err(error) => {
            warn!(%error, "could not read the active character");
            None
        }
    };
    if let Err(error) = (ActiveCharacterChanged { character }).emit(app) {
        warn!(%error, "failed to announce the active character");
    }
}

fn emit_list_changed(app: &AppHandle) {
    if let Err(error) = CharactersChanged.emit(app) {
        warn!(%error, "failed to announce the character list");
    }
}

/// Makes `id` the active character, or clears it with `None`.
pub async fn set_active(app: &AppHandle, id: Option<String>) -> Result<(), CharacterError> {
    if let Some(id) = id.clone() {
        let checked = id.clone();
        let installed = blocking(app, move |library| Ok(library.is_installed(&checked))).await?;
        if !installed {
            return Err(CharacterError::UnknownCharacter(id));
        }
    }
    app.state::<SettingsStore>()
        .update(|settings| settings.active_character = id);
    emit_active(app).await;
    Ok(())
}

/// Deletes an installed character and its saved preferences.
pub async fn remove(app: &AppHandle, id: String) -> Result<(), CharacterError> {
    let removed = id.clone();
    blocking(app, move |library| library.remove(&removed)).await?;
    let store = app.state::<SettingsStore>();
    let was_active = store.get().active_character.as_deref() == Some(id.as_str());
    store.update(|settings| {
        settings.characters.remove(&id);
        if was_active {
            settings.active_character = None;
        }
    });
    emit_list_changed(app);
    if was_active {
        emit_active(app).await;
    }
    Ok(())
}

/// Asks the user for a pack or model with a native dialog owned by `window`, then stages
/// it. `None` if the dialog was cancelled.
pub async fn stage(
    app: &AppHandle,
    window: WebviewWindow,
    kind: ImportKind,
) -> Result<Option<StagedImport>, CharacterError> {
    let dialog = app.dialog().file().set_parent(&window);
    let picked = tauri::async_runtime::spawn_blocking(move || match kind {
        ImportKind::Folder => dialog
            .set_title("Import a character folder")
            .blocking_pick_folder(),
        ImportKind::File => dialog
            .set_title("Import a character")
            .add_filter("Character pack or Live2D model", &["zip", "json"])
            .blocking_pick_file(),
    })
    .await
    .map_err(|e| CharacterError::Task(e.to_string()))?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|e| CharacterError::NotFound(e.to_string()))?;
    let source = match kind {
        ImportKind::Folder => import::Source::Folder(path),
        ImportKind::File => import::Source::File(path),
    };
    blocking(app, move |library| library.stage(&source).map(Some)).await
}

pub async fn review(
    app: &AppHandle,
    token: String,
    manifest: ModelManifest,
) -> Result<ImportReview, CharacterError> {
    let preferences = app.state::<SettingsStore>().get().characters;
    blocking(app, move |library| {
        library.review(&token, &manifest, &preferences)
    })
    .await
}

/// Stores `name` as the alias of the character `id`, whose pack calls it `pack_name`. No
/// name, or the pack's own, clears the alias.
fn store_display_name(app: &AppHandle, id: &str, pack_name: &str, name: Option<String>) {
    let alias = name.filter(|name| name != pack_name);
    app.state::<SettingsStore>()
        .update(|settings| settings.update_character(id, |c| c.display_name = alias));
}

/// Installs a reviewed import under the name the user confirmed and makes it the active
/// character.
pub async fn commit(
    app: &AppHandle,
    token: String,
    replace: bool,
    name: String,
) -> Result<(), CharacterError> {
    let name = display_name(&name).map_err(CharacterError::InvalidName)?;
    let installed = blocking(app, move |library| library.commit(&token, replace)).await?;
    store_display_name(app, &installed.id, &installed.name, name);
    emit_list_changed(app);
    set_active(app, Some(installed.id)).await
}

/// Gives an installed character an alias, or with `None` (or a blank name) goes back to
/// the pack's name.
pub async fn rename(
    app: &AppHandle,
    id: String,
    name: Option<String>,
) -> Result<(), CharacterError> {
    let name = match name {
        Some(name) => display_name(&name).map_err(CharacterError::InvalidName)?,
        None => None,
    };
    let looked_up = id.clone();
    let pack_name = blocking(app, move |library| library.pack_name(&looked_up)).await?;
    store_display_name(app, &id, &pack_name, name);
    emit_list_changed(app);
    Ok(())
}

pub async fn set_favorite(
    app: &AppHandle,
    id: String,
    favorite: bool,
) -> Result<(), CharacterError> {
    let checked = id.clone();
    blocking(app, move |library| library.pack_name(&checked)).await?;
    app.state::<SettingsStore>()
        .update(|settings| settings.update_character(&id, |c| c.favorite = favorite));
    emit_list_changed(app);
    Ok(())
}

pub async fn cancel(app: &AppHandle, token: String) -> Result<(), CharacterError> {
    blocking(app, move |library| {
        library.cancel(&token);
        Ok(())
    })
    .await
}

#[cfg(test)]
mod test_dir {
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicUsize, Ordering},
    };

    /// A scratch folder under the system temp dir, removed on drop.
    pub struct TestDir(PathBuf);

    impl TestDir {
        pub fn new(name: &str) -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let dir = std::env::temp_dir().join(format!(
                "itsumo-desk-{name}-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            let _ = fs::remove_dir_all(&dir);
            Self(dir)
        }

        pub fn path(&self, relative: &str) -> PathBuf {
            self.0.join(relative)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}
