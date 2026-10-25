use tauri::AppHandle;

use super::AppError;
use crate::{
    agent::{self, ChatStatus},
    ui::{self, HotkeyStatus},
};

/// Whether chat has a provider it can call, and if not, what to set up.
#[tauri::command]
#[specta::specta]
pub fn chat_status(app: AppHandle) -> ChatStatus {
    agent::status(&app)
}

/// Sends the user's message and resolves to the new turn's id; the reply arrives as
/// `SpeechSegment` events. Interrupts the turn in flight, if any.
#[tauri::command]
#[specta::specta]
pub async fn send_chat(app: AppHandle, text: String) -> Result<u32, AppError> {
    Ok(agent::send(&app, &text).await?)
}

/// The companion showed segment `index` of turn `turn`.
#[tauri::command]
#[specta::specta]
pub fn report_segment_shown(app: AppHandle, turn: u32, index: u32) {
    agent::segment_shown(&app, turn, index);
}

/// The chat hotkey and whether it is registered.
#[tauri::command]
#[specta::specta]
pub fn chat_hotkey(app: AppHandle) -> HotkeyStatus {
    ui::chat_hotkey(&app)
}

/// Rebinds the chat hotkey, or with `None` goes back to the default. Synchronous on
/// purpose: Tauri runs it on the main thread, where shortcuts are registered.
#[tauri::command]
#[specta::specta]
pub fn set_chat_hotkey(app: AppHandle, shortcut: Option<String>) -> Result<HotkeyStatus, AppError> {
    Ok(ui::set_chat_hotkey(&app, shortcut.as_deref())?)
}
