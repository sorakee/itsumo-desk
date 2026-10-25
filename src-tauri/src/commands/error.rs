use serde::Serialize;
use specta::Type;

/// The one error type that crosses IPC. Module errors convert into it at the command
/// boundary; messages must never carry secrets.
#[derive(Debug, thiserror::Error, Serialize, Type)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum AppError {
    #[error("invalid argument: {0}")]
    InvalidArgument(String),
    #[error("window operation failed: {0}")]
    Window(String),
    #[error("{0}")]
    Character(String),
    #[error("{0}")]
    Provider(String),
    #[error("{0}")]
    Chat(String),
    #[error("{0}")]
    Hotkey(String),
}

impl From<tauri::Error> for AppError {
    fn from(error: tauri::Error) -> Self {
        Self::Window(error.to_string())
    }
}

impl From<crate::llm::ProviderError> for AppError {
    fn from(error: crate::llm::ProviderError) -> Self {
        Self::Provider(error.to_string())
    }
}

impl From<crate::agent::AgentError> for AppError {
    fn from(error: crate::agent::AgentError) -> Self {
        Self::Chat(error.to_string())
    }
}

impl From<crate::ui::HotkeyError> for AppError {
    fn from(error: crate::ui::HotkeyError) -> Self {
        Self::Hotkey(error.to_string())
    }
}

impl From<crate::character::CharacterError> for AppError {
    fn from(error: crate::character::CharacterError) -> Self {
        Self::Character(error.to_string())
    }
}
