//! Native shell: the companion window, the settings window, and the tray icon.

mod companion;
mod cursor;
mod placement;
mod settings_window;
mod tray;

use tauri::{AppHandle, Window, WindowEvent};

pub use companion::{framing, save_framing, scale_by as scale_companion, set_click_through};

use crate::platform::SystemCursor;

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    tray::create(app)?;
    // Before the companion is shown, so the poll learns its first geometry.
    cursor::spawn(app, SystemCursor, companion::LABEL);
    companion::init(app)
}

/// Called when a second instance is launched: surface the running companion instead.
pub fn show_companion(app: &AppHandle) {
    companion::set_visible(app, true);
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() == companion::LABEL {
        companion::on_window_event(window, event);
    }
}
