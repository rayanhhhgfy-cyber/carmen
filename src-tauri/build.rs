fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().plugin(
            // The in-app `media` plugin (Rust: src/media.rs, Kotlin:
            // gen/android/…/media/MediaPlugin.kt) — declared here so the ACL
            // knows its two commands and the `media:default` permission in
            // capabilities/default.json resolves. App-level commands need no
            // entry; plugin commands do.
            "media",
            tauri_build::InlinedPlugin::new()
                .commands(&["update_media_metadata", "update_playback_state"])
                .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
        ),
    )
    .expect("failed to run tauri-build");
}
