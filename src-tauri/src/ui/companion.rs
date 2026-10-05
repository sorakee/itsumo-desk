use std::sync::{Mutex, PoisonError};

use tauri::{
    AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewWindow, Window, WindowEvent,
};
use tauri_specta::Event;
use tracing::warn;

use super::{
    cursor::{CursorTracker, Geometry},
    placement::{self, Rect},
    tray,
};
use crate::{
    events::{AlwaysOnTopChanged, ResetFraming},
    platform::{NativeWindow, ScreenPoint},
    settings::{self, Framing, SettingsStore, WindowPosition},
};

pub const LABEL: &str = "companion";

/// Logical size at scale 1; matches `tauri.conf.json`.
const BASE_SIZE: (f64, f64) = (480.0, 640.0);

/// What was last applied to the window, so redundant toggles never reach the OS. Windows
/// start interactive (D36), which keeps an error placeholder reachable.
#[derive(Default)]
struct ClickThrough(Mutex<bool>);

/// Applies saved settings and placement, then shows the window. It is declared hidden in
/// `tauri.conf.json` so it never flashes at the default position.
pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let window = app
        .get_webview_window(LABEL)
        .expect("the companion window is declared in tauri.conf.json");
    let settings = app.state::<SettingsStore>().get().companion;
    app.manage(ClickThrough::default());

    window.set_always_on_top(settings.always_on_top)?;
    window.set_size(LogicalSize::new(
        BASE_SIZE.0 * settings.scale,
        BASE_SIZE.1 * settings.scale,
    ))?;
    if let Some(position) = initial_position(&window, settings.position)? {
        window.set_position(PhysicalPosition::new(position.x, position.y))?;
    }
    window.show()?;
    sync_geometry(&window.as_ref().window());
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
    sync_geometry(&window.as_ref().window());
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

pub fn always_on_top(app: &AppHandle) -> bool {
    app.state::<SettingsStore>().get().companion.always_on_top
}

pub fn set_always_on_top(app: &AppHandle, always_on_top: bool) {
    if let Some(window) = app.get_webview_window(LABEL) {
        if let Err(error) = window.set_always_on_top(always_on_top) {
            warn!(%error, "failed to change always-on-top");
            sync_always_on_top(app);
            return;
        }
    }
    app.state::<SettingsStore>()
        .update(|settings| settings.companion.always_on_top = always_on_top);
    sync_always_on_top(app);
}

/// Brings the tray menu and the companion menu in line with the saved setting.
fn sync_always_on_top(app: &AppHandle) {
    tray::sync(app);
    let event = AlwaysOnTopChanged {
        always_on_top: always_on_top(app),
    };
    if let Err(error) = event.emit_to(app, LABEL) {
        warn!(%error, "failed to report always-on-top");
    }
}

/// Lets clicks pass through the window (`true`) or makes it interactive. The frontend
/// decides from its hit test; this only applies changes.
pub fn set_click_through(app: &AppHandle, enabled: bool) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(LABEL) else {
        return Ok(());
    };
    let state = app.state::<ClickThrough>();
    let mut current = state.0.lock().unwrap_or_else(PoisonError::into_inner);
    if *current != enabled {
        window.set_ignore_cursor_events(enabled)?;
        *current = enabled;
    }
    Ok(())
}

/// Multiplies the window size by `factor`.
pub fn scale_by(app: &AppHandle, factor: f64) -> tauri::Result<()> {
    rescale(app, |current| current * factor)
}

/// Recovers a companion the user scaled or panned out of reach: scale 1, and the frontend
/// restores the model's default framing.
pub fn reset_view(app: &AppHandle) {
    if let Err(error) = rescale(app, |_| 1.0) {
        warn!(%error, "failed to reset the companion's size");
    }
    if let Err(error) = ResetFraming.emit_to(app, LABEL) {
        warn!(%error, "failed to reset the companion's framing");
    }
}

/// Resizes the window to the scale `target` picks from the current one, within the allowed
/// range and the height of the current monitor's work area, keeping the character's feet
/// where they were.
fn rescale(app: &AppHandle, target: impl FnOnce(f64) -> f64) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(LABEL) else {
        return Ok(());
    };
    let store = app.state::<SettingsStore>();
    let current = store.get().companion.scale;
    let scale_factor = window.scale_factor()?;
    let area = window.current_monitor()?.map(|monitor| work_area(&monitor));

    let mut scale = settings::clamp_scale(target(current));
    if let Some(area) = area {
        let fits = f64::from(area.height) / (BASE_SIZE.1 * scale_factor);
        scale = scale.min(fits.max(settings::MIN_SCALE));
    }
    if (scale - current).abs() < 1e-3 {
        return Ok(());
    }

    let position = window.outer_position()?;
    let size = window.outer_size()?;
    let target = placement::rescale(
        Rect {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        },
        physical_size(scale, scale_factor),
        area,
    );
    let origin = ScreenPoint {
        x: target.x,
        y: target.y,
    };
    if let Err(error) = window.set_outer_bounds(origin, (target.width, target.height)) {
        warn!(%error, "failed to resize the companion");
        return Ok(());
    }
    store.update(|settings| settings.companion.scale = scale);
    Ok(())
}

pub fn framing(app: &AppHandle, character: &str) -> Option<Framing> {
    app.state::<SettingsStore>()
        .get()
        .characters
        .get(character)
        .and_then(|character| character.framing)
}

/// Saves `framing` for `character`; `None` goes back to the model's default.
pub fn save_framing(app: &AppHandle, character: String, framing: Option<Framing>) {
    app.state::<SettingsStore>().update(|settings| {
        settings.update_character(&character, |c| c.framing = framing);
    });
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    match event {
        WindowEvent::Moved(position) => {
            sync_geometry(window);
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
        WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
            sync_geometry(window);
        }
        // Alt+F4 would otherwise destroy the companion; hide it to the tray instead.
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            set_visible(window.app_handle(), false);
        }
        _ => {}
    }
}

/// Tells the cursor poll where the client area is, or pauses it while hidden.
fn sync_geometry(window: &Window) {
    let Some(tracker) = window.try_state::<CursorTracker>() else {
        return;
    };
    match geometry(window) {
        Ok(geometry) => tracker.set_geometry(geometry),
        Err(error) => warn!(%error, "failed to read companion geometry"),
    }
}

fn geometry(window: &Window) -> tauri::Result<Option<Geometry>> {
    if !window.is_visible()? {
        return Ok(None);
    }
    let origin = window.inner_position()?;
    Ok(Some(Geometry {
        origin: ScreenPoint {
            x: origin.x,
            y: origin.y,
        },
        scale_factor: window.scale_factor()?,
    }))
}

fn physical_size(scale: f64, scale_factor: f64) -> (u32, u32) {
    // Sizes are at most a few thousand pixels, far inside u32.
    let pixels = |logical: f64| (logical * scale * scale_factor).round() as u32;
    (pixels(BASE_SIZE.0), pixels(BASE_SIZE.1))
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
