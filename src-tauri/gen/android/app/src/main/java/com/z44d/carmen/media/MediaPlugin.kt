package com.z44d.carmen.media

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

/** Track facts pushed by `updateNativeMediaSession` (camelCase on the wire). */
@InvokeArg
class MediaMetadataArgs {
  var title: String? = null
  var artist: String? = null
  var album: String? = null
  var artworkUrl: String? = null
  var duration: Double? = null
}

/** Transport facts pushed by `updateNativePlaybackState`. */
@InvokeArg
class PlaybackStateArgs {
  var active: Boolean = false
  var playing: Boolean = false
  var position: Double? = null
  var duration: Double? = null
}

/**
 * Rust installs the event channel once at startup
 * (`src-tauri/src/media.rs` → `setEventHandler`); Kotlin pushes every
 * notification / lock-screen / headset button into it, Rust re-emits them
 * as `media-control:<action>` events for the page.
 */
@InvokeArg
class SetEventHandlerArgs {
  lateinit var handler: Channel
}

/**
 * The Kotlin half of the in-app `media` Tauri plugin — pure IPC, no logic.
 * Everything interesting lives in [MediaBridge] (state + service
 * orchestration) and [PlaybackService] (the media3 session + notification).
 */
@TauriPlugin
class MediaPlugin(private val activity: Activity) : Plugin(activity) {

  @Command
  fun setEventHandler(invoke: Invoke) {
    val args = invoke.parseArgs(SetEventHandlerArgs::class.java)
    MediaBridge.attach(activity, args.handler)
    invoke.resolve()
  }

  @Command
  fun updateMediaMetadata(invoke: Invoke) {
    val args = invoke.parseArgs(MediaMetadataArgs::class.java)
    MediaBridge.publishMetadata(args)
    invoke.resolve()
  }

  @Command
  fun updatePlaybackState(invoke: Invoke) {
    val args = invoke.parseArgs(PlaybackStateArgs::class.java)
    MediaBridge.publishState(args)
    invoke.resolve()
  }
}
