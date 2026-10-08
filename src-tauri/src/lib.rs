//! Carmen — Tauri v2 shell.
//!
//! The Rust side intentionally stays thin: plugins own cross-cutting
//! capabilities (fs, sql, opener, window-state) and `commands` only exposes the
//! few app-level operations plugins do not cover.

mod commands;
mod tray;

/// Runs the Tauri event loop.
///
/// Desktop lifecycle contract (see DEVELOPMENT.md):
/// * closing / hiding the main window never exits the process — it collapses
///   into the system tray so background audio keeps playing;
/// * quitting only happens through the tray "Quit" item (or the OS request).
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            tray::init(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                #[cfg(desktop)]
                {
                    // Route / playback state is flushed continuously from the
                    // frontend, so it is always safe to simply hide.
                    api.prevent_close();
                    let _ = window.hide();
                }
                #[cfg(not(desktop))]
                {
                    let _ = (api, window);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_info,
            commands::app::storage_paths,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Carmen");
}
