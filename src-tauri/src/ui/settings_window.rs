use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tracing::warn;

const LABEL: &str = "settings";

/// Focuses the settings window, creating it if needed. It is destroyed on close rather than
/// hidden, so it costs nothing while the user is not looking at it.
pub fn open(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let result = window
            .unminimize()
            .and_then(|()| window.show())
            .and_then(|()| window.set_focus());
        if let Err(error) = result {
            warn!(%error, "failed to focus the settings window");
        }
        return;
    }

    let app = app.clone();
    // Building a webview from an event handler deadlocks on Windows (a WebView2 limitation),
    // so build it from a runtime thread instead.
    tauri::async_runtime::spawn(async move {
        let result =
            WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("settings.html".into()))
                .title("Itsumo Desk Settings")
                .inner_size(880.0, 620.0)
                .min_inner_size(640.0, 480.0)
                .center()
                .build();
        if let Err(error) = result {
            warn!(%error, "failed to open the settings window");
        }
    });
}
