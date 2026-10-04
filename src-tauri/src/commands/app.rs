use serde::Serialize;
use specta::Type;
use tauri::AppHandle;

use crate::ui;

#[derive(Debug, Serialize, Type)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

#[tauri::command]
#[specta::specta]
pub fn app_info(app: AppHandle) -> AppInfo {
    let info = app.package_info();
    AppInfo {
        name: info.name.clone(),
        version: info.version.to_string(),
    }
}

/// Opens the settings window, or focuses it if it is already open.
#[tauri::command]
#[specta::specta]
pub fn open_settings(app: AppHandle) {
    ui::open_settings(&app);
}
