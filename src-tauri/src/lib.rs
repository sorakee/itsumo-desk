mod character;
mod commands;
mod events;
mod platform;
mod settings;
mod ui;

use tauri::{Manager, RunEvent};
use tauri_specta::{collect_commands, collect_events, Builder};
use tracing::warn;

use character::CharacterLibrary;
use settings::SettingsStore;

/// Folder under `%APPDATA%` that holds `config.json` and the character packs.
const APP_DIR: &str = "itsumo-desk";
const CHARACTERS_DIR: &str = "characters";

fn ipc_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            commands::app::app_info,
            commands::app::open_settings,
            commands::companion::always_on_top,
            commands::companion::set_always_on_top,
            commands::companion::hide_companion,
            commands::companion::set_click_through,
            commands::companion::scale_companion,
            commands::companion::character_framing,
            commands::companion::save_character_framing,
            commands::companion::clear_character_framing,
            commands::character::list_characters,
            commands::character::active_character,
            commands::character::set_active_character,
            commands::character::remove_character,
            commands::character::stage_character_import,
            commands::character::review_character_import,
            commands::character::commit_character_import,
            commands::character::cancel_character_import,
        ])
        .events(collect_events![
            events::CursorMoved,
            events::AlwaysOnTopChanged,
            events::ResetFraming,
            events::ActiveCharacterChanged,
            events::CharactersChanged
        ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_max_level(if cfg!(debug_assertions) {
            tracing::Level::DEBUG
        } else {
            tracing::Level::INFO
        })
        .init();

    let ipc = ipc_builder();

    tauri::Builder::default()
        // Must be registered first so a second launch exits before building anything.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            ui::show_companion(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .register_asynchronous_uri_scheme_protocol(character::SCHEME, |ctx, request, responder| {
            character::handle_protocol(ctx.app_handle(), request, responder);
        })
        .invoke_handler(ipc.invoke_handler())
        .setup(move |app| {
            ipc.mount_events(app);
            let config_dir = app.path().config_dir()?.join(APP_DIR);
            app.manage(SettingsStore::open(&config_dir));
            app.manage(CharacterLibrary::open(config_dir.join(CHARACTERS_DIR)));
            ui::setup(app.handle())?;
            Ok(())
        })
        .on_window_event(ui::on_window_event)
        .build(tauri::generate_context!())
        // Startup invariant: without a running Tauri runtime there is nothing to recover to.
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                // The debounced writer may still hold the last window move.
                if let Some(store) = app.try_state::<SettingsStore>() {
                    if let Err(error) = store.flush() {
                        warn!(%error, "failed to save settings on exit");
                    }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use specta_typescript::Typescript;

    /// Regenerates the TypeScript IPC bindings. CI fails if the committed file is stale.
    #[test]
    fn export_bindings() {
        super::ipc_builder()
            .export(Typescript::default(), "../src/ipc/bindings.ts")
            .expect("failed to export TypeScript bindings");
    }
}
