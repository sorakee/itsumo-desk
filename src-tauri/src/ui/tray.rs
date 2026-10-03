use tauri::{
    menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Wry,
};
use tracing::warn;

use super::{companion, settings_window};
use crate::settings::SettingsStore;

const SHOW_HIDE: &str = "show-hide";
const ALWAYS_ON_TOP: &str = "always-on-top";
const RESET_VIEW: &str = "reset-view";
const SETTINGS: &str = "settings";
const QUIT: &str = "quit";

/// Menu items whose label or check state follows app state.
struct TrayMenu {
    show_hide: MenuItem<Wry>,
    always_on_top: CheckMenuItem<Wry>,
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let show_hide = MenuItem::with_id(app, SHOW_HIDE, "Show", true, None::<&str>)?;
    let always_on_top = CheckMenuItem::with_id(
        app,
        ALWAYS_ON_TOP,
        "Always on top",
        true,
        app.state::<SettingsStore>().get().companion.always_on_top,
        None::<&str>,
    )?;
    let reset_view = MenuItem::with_id(
        app,
        RESET_VIEW,
        "Reset size and framing",
        true,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(app, SETTINGS, "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT, "Quit Itsumo Desk", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &show_hide,
            &always_on_top,
            &reset_view,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Itsumo Desk")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu_event)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                companion::set_visible(tray.app_handle(), true);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;

    app.manage(TrayMenu {
        show_hide,
        always_on_top,
    });
    Ok(())
}

/// Brings the menu in line with the companion's visibility and the saved settings.
pub fn sync(app: &AppHandle) {
    let Some(menu) = app.try_state::<TrayMenu>() else {
        return;
    };
    let label = if companion::is_visible(app) {
        "Hide"
    } else {
        "Show"
    };
    let always_on_top = app.state::<SettingsStore>().get().companion.always_on_top;
    let result = menu
        .show_hide
        .set_text(label)
        .and_then(|()| menu.always_on_top.set_checked(always_on_top));
    if let Err(error) = result {
        warn!(%error, "failed to update the tray menu");
    }
}

fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        SHOW_HIDE => companion::toggle_visible(app),
        ALWAYS_ON_TOP => {
            let current = app.state::<SettingsStore>().get().companion.always_on_top;
            companion::set_always_on_top(app, !current);
        }
        RESET_VIEW => companion::reset_view(app),
        SETTINGS => settings_window::open(app),
        QUIT => app.exit(0),
        _ => {}
    }
}
