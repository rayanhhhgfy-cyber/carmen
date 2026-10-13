//! Carmen — Tauri v2 shell.
//!
//! The Rust side intentionally stays thin: plugins own cross-cutting
//! capabilities (fs, sql, opener, window-state, plus the in-app `media`
//! bridge) and `commands` only exposes the few app-level operations plugins
//! do not cover.

mod commands;
// In-app Tauri plugin: the Rust half of the Android media-session bridge
// (Kotlin: gen/android/…/media/). Commands live on the plugin namespace
// (`plugin:media|…`); see the module docs and DEVELOPMENT.md.
mod media;
// The tray (menus, tray icons, minimize-to-tray) only exists on desktop —
// `tauri::menu` / `tauri::tray` are compiled out on mobile targets, so the
// whole module is gated or the Android/iOS builds fail to resolve them.
#[cfg(desktop)]
mod tray;

#[cfg(target_os = "macos")]
use tauri::Manager;

/// Runs the Tauri event loop.
///
/// Desktop lifecycle contract (see DEVELOPMENT.md):
/// * closing / hiding the main window never exits the process — it collapses
///   into the system tray so background audio keeps playing;
/// * reopening (tray click, Dock icon click on macOS, launcher) brings the
///   same window back on the previously saved route;
/// * quitting only happens through the tray "Quit" item (or the OS request).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        // In-app plugin — the IPC spine of the Android media session
        // (metadata / playback state in, `media-control:*` events out).
        .plugin(media::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        // Shared https links (`?song=…`) open the installed app on Android
        // through App Links (see DEVELOPMENT.md → "Opening the app from a
        // shared link"); the config in tauri.conf.json declares the host.
        .plugin(tauri_plugin_deep_link::init())
        // Motion artwork: the iTunes/amp-api hops are not CORS-reachable from
        // the WebView (amp-api even checks the Origin header), so they go
        // through Rust (see frontend/src/artwork/motion.ts).
        .plugin(tauri_plugin_http::init());

    // Window placement restore is a desktop concern — the plugin's `Builder`
    // is compiled out on mobile targets, so registering it must be too.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());

    builder
        .setup(|app| {
            // Tray icon + menu: desktop only (see `mod tray` above).
            #[cfg(desktop)]
            tray::init(app.handle())?;
            #[cfg(not(desktop))]
            let _ = app;
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
            commands::battery::battery_status,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Carmen")
        .run(|app, event| {
            // Dock icon click on macOS: `applicationShouldHandleReopen` fires
            // when the user clicks the Dock icon while the window is hidden in
            // the tray — without this handler the click appears to do nothing.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
