//! User settings persisted to `%APPDATA%/itsumo-desk/config.json`.

mod store;

pub use store::SettingsStore;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub companion: CompanionSettings,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CompanionSettings {
    /// Outer position in physical pixels on the virtual desktop. `None` until the window
    /// has been moved once.
    pub position: Option<WindowPosition>,
    pub always_on_top: bool,
}

impl Default for CompanionSettings {
    fn default() -> Self {
        Self {
            position: None,
            always_on_top: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowPosition {
    pub x: i32,
    pub y: i32,
}
