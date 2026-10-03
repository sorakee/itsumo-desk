use tauri::AppHandle;

use super::AppError;
use crate::{settings::Framing, ui};

/// Character ids are folder names or dev model paths; anything longer is not one.
const MAX_CHARACTER_ID_LEN: usize = 512;

fn validate_character(character: &str) -> Result<(), AppError> {
    if character.is_empty() || character.len() > MAX_CHARACTER_ID_LEN {
        return Err(AppError::InvalidArgument("character id".into()));
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn set_click_through(app: AppHandle, enabled: bool) -> Result<(), AppError> {
    Ok(ui::set_click_through(&app, enabled)?)
}

/// Multiplies the companion's size by `factor`; the result is clamped to the allowed range.
#[tauri::command]
#[specta::specta]
pub fn scale_companion(app: AppHandle, factor: f64) -> Result<(), AppError> {
    if !factor.is_finite() || factor <= 0.0 {
        return Err(AppError::InvalidArgument("factor must be positive".into()));
    }
    Ok(ui::scale_companion(&app, factor)?)
}

/// The saved framing for `character`, or `None` if the user never adjusted it.
#[tauri::command]
#[specta::specta]
pub fn character_framing(app: AppHandle, character: String) -> Result<Option<Framing>, AppError> {
    validate_character(&character)?;
    Ok(ui::framing(&app, &character))
}

/// Saves `framing` for `character`, clamped to the allowed range.
#[tauri::command]
#[specta::specta]
pub fn save_character_framing(
    app: AppHandle,
    character: String,
    framing: Framing,
) -> Result<(), AppError> {
    validate_character(&character)?;
    let framing = framing
        .validated()
        .ok_or_else(|| AppError::InvalidArgument("framing must be finite".into()))?;
    ui::save_framing(&app, character, Some(framing));
    Ok(())
}

/// Forgets the saved framing for `character`, so the model's default applies again.
#[tauri::command]
#[specta::specta]
pub fn clear_character_framing(app: AppHandle, character: String) -> Result<(), AppError> {
    validate_character(&character)?;
    ui::save_framing(&app, character, None);
    Ok(())
}
