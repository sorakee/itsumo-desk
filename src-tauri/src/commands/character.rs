use tauri::{AppHandle, WebviewWindow};

use super::AppError;
use crate::character::{
    self, ActiveCharacter, CharacterMapping, CharacterSummary, ImportKind, ImportReview, Mapping,
    ModelManifest, StagedImport,
};

fn validate_id(id: &str) -> Result<(), AppError> {
    if !character::is_valid_id(id) {
        return Err(AppError::InvalidArgument("character id".into()));
    }
    Ok(())
}

fn validate_token(token: &str) -> Result<(), AppError> {
    if !character::is_valid_token(token) {
        return Err(AppError::InvalidArgument("import token".into()));
    }
    Ok(())
}

/// The installed characters, by name.
#[tauri::command]
#[specta::specta]
pub async fn list_characters(app: AppHandle) -> Result<Vec<CharacterSummary>, AppError> {
    Ok(character::list(&app).await?)
}

/// The character the companion shows, or `None` if no character is active.
#[tauri::command]
#[specta::specta]
pub async fn active_character(app: AppHandle) -> Result<Option<ActiveCharacter>, AppError> {
    Ok(character::active(&app).await?)
}

/// Switches the companion to an installed character, or to none.
#[tauri::command]
#[specta::specta]
pub async fn set_active_character(app: AppHandle, id: Option<String>) -> Result<(), AppError> {
    if let Some(id) = &id {
        validate_id(id)?;
    }
    Ok(character::set_active(&app, id).await?)
}

/// Deletes an installed character and its saved preferences.
#[tauri::command]
#[specta::specta]
pub async fn remove_character(app: AppHandle, id: String) -> Result<(), AppError> {
    validate_id(&id)?;
    Ok(character::remove(&app, id).await?)
}

/// Gives an installed character a display name, or with `None` (or a blank name) goes
/// back to the pack's name.
#[tauri::command]
#[specta::specta]
pub async fn rename_character(
    app: AppHandle,
    id: String,
    name: Option<String>,
) -> Result<(), AppError> {
    validate_id(&id)?;
    Ok(character::rename(&app, id, name).await?)
}

/// Marks an installed character as a favourite, or unmarks it.
#[tauri::command]
#[specta::specta]
pub async fn set_character_favorite(
    app: AppHandle,
    id: String,
    favorite: bool,
) -> Result<(), AppError> {
    validate_id(&id)?;
    Ok(character::set_favorite(&app, id, favorite).await?)
}

/// An installed character's model and mapping, for the mapping editor.
#[tauri::command]
#[specta::specta]
pub async fn character_mapping(app: AppHandle, id: String) -> Result<CharacterMapping, AppError> {
    validate_id(&id)?;
    Ok(character::mapping(&app, id).await?)
}

/// Saves the user's edits to a character's mapping and returns it as the editor shows it.
#[tauri::command]
#[specta::specta]
pub async fn save_character_mapping(
    app: AppHandle,
    id: String,
    mapping: Mapping,
) -> Result<CharacterMapping, AppError> {
    validate_id(&id)?;
    Ok(character::save_mapping(&app, id, mapping).await?)
}

/// Drops the user's edits to a character's mapping, going back to the pack's own.
#[tauri::command]
#[specta::specta]
pub async fn reset_character_mapping(
    app: AppHandle,
    id: String,
) -> Result<CharacterMapping, AppError> {
    validate_id(&id)?;
    Ok(character::reset_mapping(&app, id).await?)
}

/// Lets the user pick a pack or model, then copies and validates it in staging. `None` if
/// the dialog was cancelled.
#[tauri::command]
#[specta::specta]
pub async fn stage_character_import(
    app: AppHandle,
    window: WebviewWindow,
    kind: ImportKind,
) -> Result<Option<StagedImport>, AppError> {
    Ok(character::stage(&app, window, kind).await?)
}

/// Checks a staged import against the manifest the webview built from its model.
#[tauri::command]
#[specta::specta]
pub async fn review_character_import(
    app: AppHandle,
    token: String,
    manifest: ModelManifest,
) -> Result<ImportReview, AppError> {
    validate_token(&token)?;
    Ok(character::review(&app, token, manifest).await?)
}

/// Installs a reviewed import under `name` and makes it active. `replace` allows replacing
/// an installed character with the same id.
#[tauri::command]
#[specta::specta]
pub async fn commit_character_import(
    app: AppHandle,
    token: String,
    replace: bool,
    name: String,
) -> Result<(), AppError> {
    validate_token(&token)?;
    Ok(character::commit(&app, token, replace, name).await?)
}

/// Discards a staged import.
#[tauri::command]
#[specta::specta]
pub async fn cancel_character_import(app: AppHandle, token: String) -> Result<(), AppError> {
    validate_token(&token)?;
    Ok(character::cancel(&app, token).await?)
}
