use tauri::{ipc::Channel, AppHandle};

use super::AppError;
use crate::{
    character,
    llm::{self, PresetInfo, ProviderSummary, ProviderUpdate, TestEvent, TestReport},
    settings::Preset,
};

fn validate_id(id: &str) -> Result<(), AppError> {
    // Profile ids follow the character id rules.
    if !character::is_valid_id(id) {
        return Err(AppError::InvalidArgument("provider id".into()));
    }
    Ok(())
}

/// The presets a new profile can start from, in display order.
#[tauri::command]
#[specta::specta]
pub fn provider_presets() -> Vec<PresetInfo> {
    llm::preset_list()
}

/// The provider profiles, in the order they were added.
#[tauri::command]
#[specta::specta]
pub async fn list_providers(app: AppHandle) -> Result<Vec<ProviderSummary>, AppError> {
    Ok(llm::list(&app).await?)
}

/// Creates a profile from a preset and returns its id.
#[tauri::command]
#[specta::specta]
pub async fn add_provider(app: AppHandle, preset: Preset) -> Result<String, AppError> {
    Ok(llm::add(&app, preset).await?)
}

/// Saves a profile's editable fields.
#[tauri::command]
#[specta::specta]
pub async fn update_provider(
    app: AppHandle,
    id: String,
    update: ProviderUpdate,
) -> Result<(), AppError> {
    validate_id(&id)?;
    Ok(llm::update(&app, id, update).await?)
}

/// Deletes a profile and its stored key.
#[tauri::command]
#[specta::specta]
pub async fn remove_provider(app: AppHandle, id: String) -> Result<(), AppError> {
    validate_id(&id)?;
    Ok(llm::remove(&app, id).await?)
}

/// Makes a profile the one chat uses, or with `None` leaves chat without one.
#[tauri::command]
#[specta::specta]
pub async fn set_main_provider(app: AppHandle, id: Option<String>) -> Result<(), AppError> {
    if let Some(id) = &id {
        validate_id(id)?;
    }
    Ok(llm::set_main(&app, id).await?)
}

/// Stores a profile's API key in the OS credential store. Nothing ever returns it.
#[tauri::command]
#[specta::specta]
pub async fn set_provider_key(app: AppHandle, id: String, key: String) -> Result<(), AppError> {
    validate_id(&id)?;
    Ok(llm::set_key(&app, id, key).await?)
}

/// Deletes a profile's stored API key.
#[tauri::command]
#[specta::specta]
pub async fn clear_provider_key(app: AppHandle, id: String) -> Result<(), AppError> {
    validate_id(&id)?;
    Ok(llm::clear_key(&app, id).await?)
}

/// The model names the profile's server lists.
#[tauri::command]
#[specta::specta]
pub async fn provider_models(app: AppHandle, id: String) -> Result<Vec<String>, AppError> {
    validate_id(&id)?;
    Ok(llm::models(&app, id).await?)
}

/// Asks the profile's model for one short sentence, streaming it through `channel`.
#[tauri::command]
#[specta::specta]
pub async fn test_provider(
    app: AppHandle,
    id: String,
    channel: Channel<TestEvent>,
) -> Result<TestReport, AppError> {
    validate_id(&id)?;
    Ok(llm::test(&app, id, |event| channel.send(event).is_ok()).await?)
}
