//! App-level commands — the small slice of native behaviour that the plugin
//! set does not already cover. Everything else (fs, sql, opener) is exposed by
//! its Tauri plugin and consumed directly from the frontend.

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Canonical on-disk locations for the offline library.
///
/// The frontend never guesses paths: it asks once at boot and then uses the
/// `fs` plugin (scoped to `$APPDATA/**` in `capabilities/default.json`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoragePaths {
    /// Application data root (sandboxed per platform).
    pub app_data: String,
    /// `<app data>/songs` — one folder per downloaded track.
    pub songs_dir: String,
    /// `<app data>/artwork` — cached cover art for OS media controls.
    pub artwork_dir: String,
    /// SQLite database file managed by `tauri-plugin-sql`.
    pub database: String,
}

#[tauri::command]
pub fn storage_paths(app: AppHandle) -> Result<StoragePaths, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let songs = base.join("songs");
    let artwork = base.join("artwork");
    Ok(StoragePaths {
        app_data: base.to_string_lossy().into_owned(),
        songs_dir: songs.to_string_lossy().into_owned(),
        artwork_dir: artwork.to_string_lossy().into_owned(),
        database: base.join("carmen.db").to_string_lossy().into_owned(),
    })
}

/// Static runtime facts used by Settings → About and by diagnostics.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub platform: String,
    pub arch: String,
    pub desktop: bool,
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "Carmen".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        desktop: cfg!(desktop),
    }
}
