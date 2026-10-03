use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow, Window, WindowEvent};
use tracing::warn;

use super::{
    placement::{self, Rect},
    tray,
};
use crate::settings::{SettingsStore, WindowPosition};

pub const LABEL: &str = "companion";

/// Applies saved settings and placement, then shows the window. It is declared hidden in
/// `tauri.conf.json` so it never flashes at the default position.
pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let window = app
        .get_webview_window(LABEL)
        .expect("the companion window is declared in tauri.conf.json");
    let settings = app.state::<SettingsStore>().get().companion;

    window.set_always_on_top(settings.always_on_top)?;
    if let Some(position) = initial_position(&window, settings.position)? {
        window.set_position(PhysicalPosition::new(position.x, position.y))?;
    }
    window.show()?;
    tray::sync(app);
    Ok(())
}

pub fn set_visible(app: &AppHandle, visible: bool) {
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    let result = if visible {
        window.show().and_then(|()| window.set_focus())
    } else {
        window.hide()
    };
    if let Err(error) = result {
        warn!(%error, visible, "failed to change companion visibility");
    }
    tray::sync(app);
}

pub fn toggle_visible(app: &AppHandle) {
    set_visible(app, !is_visible(app));
}

pub fn is_visible(app: &AppHandle) -> bool {
    app.get_webview_window(LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

pub fn set_always_on_top(app: &AppHandle, always_on_top: bool) {
    if let Some(window) = app.get_webview_window(LABEL) {
        if let Err(error) = window.set_always_on_top(always_on_top) {
            warn!(%error, "failed to change always-on-top");
            tray::sync(app);
            return;
        }
    }
    app.state::<SettingsStore>()
        .update(|settings| settings.companion.always_on_top = always_on_top);
    tray::sync(app);
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    match event {
        WindowEvent::Moved(position) => {
            // Windows parks minimised windows far off-screen; that is not a placement.
            if window.is_minimized().unwrap_or(false) {
                return;
            }
            let position = WindowPosition {
                x: position.x,
                y: position.y,
            };
            window
                .state::<SettingsStore>()
                .update(|settings| settings.companion.position = Some(position));
        }
        // Alt+F4 would otherwise destroy the companion; hide it to the tray instead.
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            set_visible(window.app_handle(), false);
        }
        _ => {}
    }
}

fn initial_position(
    window: &WebviewWindow,
    saved: Option<WindowPosition>,
) -> tauri::Result<Option<WindowPosition>> {
    let size = window.outer_size()?;
    let work_areas: Vec<Rect> = window.available_monitors()?.iter().map(work_area).collect();
    let primary = window.primary_monitor()?.map(|monitor| work_area(&monitor));
    Ok(placement::initial_position(
        saved,
        (size.width, size.height),
        &work_areas,
        primary,
    ))
}

fn work_area(monitor: &tauri::Monitor) -> Rect {
    let area = monitor.work_area();
    Rect {
        x: area.position.x,
        y: area.position.y,
        width: area.size.width,
        height: area.size.height,
    }
}
