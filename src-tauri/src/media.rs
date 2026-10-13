//! The in-app `media` plugin — the Tauri half of the Android media-session
//! bridge (Kotlin side: `gen/android/…/media/MediaPlugin`).
//!
//! The WebView owns playback (it is the only side that ever sees stream
//! URLs — the API deliberately sanitises them out, see `server/sanitizers.py`)
//! and Android's System WebView ships no `navigator.mediaSession`, so the
//! shade / quick-settings / lock-screen card is a native media3
//! `MediaSession` living in a foreground service. This plugin is the IPC
//! spine between the two halves:
//!
//! * web → native — the `plugin:media|update_media_metadata` and
//!   `plugin:media|update_playback_state` commands, forwarded to Kotlin
//!   through [`PluginHandle::run_mobile_plugin`];
//! * native → web — Kotlin pushes transport buttons (notification, lock
//!   screen, headset) through a [`Channel`] installed once at startup; each
//!   one is re-emitted as a `media-control:<action>` event the page
//!   listens for.
//!
//! On desktop — and under a plain `vite dev` anywhere — the commands are
//! silent no-ops: the Web Media Session API already owns the OS integration
//! there.

use tauri::{
    plugin::{Builder, PluginApi, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime,
};

#[cfg(target_os = "android")]
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    Emitter,
};

/// Java package of the Kotlin plugin class (`com.z44d.carmen.media.MediaPlugin`).
#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.z44d.carmen";

/// Transport actions Kotlin may push. Anything else on the channel is dropped.
#[cfg(target_os = "android")]
const CONTROL_ACTIONS: &[&str] = &[
    "play", "pause", "toggle", "next", "previous", "seek", "stop", "sync",
];

/// One button press coming from Kotlin: `{"action": …, "value": …}`.
#[cfg(target_os = "android")]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlEvent {
    action: String,
    value: Option<f64>,
}

/// Rust → Kotlin payload for the internal `setEventHandler` command
/// (`@InvokeArg class … { lateinit var handler: Channel }` on the Kotlin side).
#[cfg(target_os = "android")]
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct EventHandler {
    handler: Channel,
}

/// What the page tells native about the *track* (names, cover, length).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaMetadata {
    #[allow(dead_code)]
    pub title: String,
    #[allow(dead_code)]
    pub artist: String,
    #[allow(dead_code)]
    pub album: Option<String>,
    #[allow(dead_code)]
    pub artwork_url: Option<String>,
    #[allow(dead_code)]
    pub duration: Option<f64>,
}

/// What the page tells native about the *transport* (loaded? playing? where?).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackState {
    #[allow(dead_code)]
    pub active: bool,
    #[allow(dead_code)]
    pub playing: bool,
    #[allow(dead_code)]
    pub position: Option<f64>,
    #[allow(dead_code)]
    pub duration: Option<f64>,
}

/// Handle to the registered Kotlin plugin; the commands run through it.
pub struct MediaApi<R: Runtime> {
    /// `None` on desktop, where the plugin commands are no-ops.
    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    handle: Option<PluginHandle<R>>,
}

impl<R: Runtime> MediaApi<R> {
    /// Forwards a command to the Kotlin `@Command` of the same name.
    #[cfg(target_os = "android")]
    async fn forward(
        &self,
        command: &'static str,
        payload: impl serde::Serialize + Send,
    ) -> Result<(), String> {
        let handle = self
            .handle
            .as_ref()
            .ok_or_else(|| "media plugin is not initialized".to_string())?;
        handle
            .run_mobile_plugin_async::<()>(command, payload)
            .await
            .map_err(|err| format!("media plugin {command}: {err}"))
    }

    /// Desktop keeps the Web Media Session as the only integration.
    #[cfg(not(target_os = "android"))]
    async fn forward(
        &self,
        _command: &'static str,
        _payload: impl serde::Serialize + Send,
    ) -> Result<(), String> {
        Ok(())
    }
}

/// Web → native: what is playing (title / artist / album / cover / length).
#[tauri::command]
pub async fn update_media_metadata<R: Runtime>(
    _app: tauri::AppHandle<R>,
    api: tauri::State<'_, MediaApi<R>>,
    metadata: MediaMetadata,
) -> Result<(), String> {
    api.forward("updateMediaMetadata", &metadata).await
}

/// Web → native: loaded? playing? at which position?
#[tauri::command]
pub async fn update_playback_state<R: Runtime>(
    _app: tauri::AppHandle<R>,
    api: tauri::State<'_, MediaApi<R>>,
    playback: PlaybackState,
) -> Result<(), String> {
    api.forward("updatePlaybackState", &playback).await
}

/// Registers the plugin — Kotlin class + event channel on Android, a no-op
/// shell everywhere else.
pub fn init<R: Runtime>() -> TauriPlugin<R, serde_json::Value> {
    Builder::new("media")
        .invoke_handler(tauri::generate_handler![
            update_media_metadata,
            update_playback_state
        ])
        .setup(|app, api| {
            app.manage(build_api(app, api)?);
            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
fn build_api<R: Runtime>(
    app: &AppHandle<R>,
    api: PluginApi<R, serde_json::Value>,
) -> Result<MediaApi<R>, Box<dyn std::error::Error>> {
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "MediaPlugin")?;

    // Kotlin pushes every notification / lock-screen / headset button into
    // this channel; each one becomes a `media-control:<action>` event for
    // the page (`frontend/src/platform/androidMedia.ts`).
    let app_handle = app.clone();
    handle.run_mobile_plugin::<()>(
        "setEventHandler",
        EventHandler {
            handler: Channel::new(move |response| {
                if let InvokeResponseBody::Json(payload) = &response {
                    if let Ok(event) = serde_json::from_str::<ControlEvent>(payload) {
                        if CONTROL_ACTIONS.contains(&event.action.as_str()) {
                            let _ = app_handle
                                .emit(&format!("media-control:{}", event.action), event.value);
                        }
                    }
                }
                Ok(())
            }),
        },
    )?;

    Ok(MediaApi {
        handle: Some(handle),
    })
}

#[cfg(not(target_os = "android"))]
fn build_api<R: Runtime>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, serde_json::Value>,
) -> Result<MediaApi<R>, Box<dyn std::error::Error>> {
    Ok(MediaApi { handle: None })
}
