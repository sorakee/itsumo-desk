mod commands;

use tauri_specta::{collect_commands, Builder};

fn ipc_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new().commands(collect_commands![commands::app::app_info])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ipc = ipc_builder();

    tauri::Builder::default()
        .invoke_handler(ipc.invoke_handler())
        .setup(move |app| {
            ipc.mount_events(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        // Startup invariant: without a running Tauri runtime there is nothing to recover to.
        .expect("error while running tauri application");
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
