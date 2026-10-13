package com.z44d.carmen.media

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import app.tauri.plugin.Channel
import app.tauri.plugin.JSObject
import org.json.JSONObject

/**
 * State + orchestration half of the Android media bridge.
 *
 * The WebView owns the audio element (it holds the stream URLs the API
 * deliberately never exposes — see `server/sanitizers.py`), so this object
 * never plays anything itself: it caches what the page publishes through
 * the in-app `media` Tauri plugin ([MediaPlugin] is the entry point),
 * keeps [PlaybackService] — a media3 `MediaSessionService` — mirroring
 * that state, and routes the notification / lock-screen / headset buttons
 * back into the page over the plugin's event channel.
 *
 * Both directions are marshalled onto the main thread: Tauri commands can
 * arrive on any thread, and the service reads the cached state from the
 * main thread — so the single `state` document is only ever touched there.
 */
object MediaBridge {
  /** Commands, mirrored by `frontend/src/platform/androidMedia.ts`. */
  const val CMD_PLAY = "play"
  const val CMD_PAUSE = "pause"
  const val CMD_TOGGLE = "toggle"
  const val CMD_NEXT = "next"
  const val CMD_PREVIOUS = "previous"
  const val CMD_SEEK = "seek"
  const val CMD_STOP = "stop"
  const val CMD_SYNC = "sync"

  /** After a command, ask the page to re-push so its state always wins. */
  private const val ECHO_DELAY_MS = 700L

  private const val NOTIFICATION_PERMISSION_REQUEST = 0x4D65

  private val main = Handler(Looper.getMainLooper())

  private var activity: Activity? = null
  private var appContext: Context? = null

  /** Rust-installed event channel — every button goes back through it. */
  @Volatile
  private var channel: Channel? = null

  /** Latest state pushed by the page (main thread only). */
  private var state: JSONObject? = null
  private var starting = false
  private var askedNotificationPermission = false

  /** A track is loaded — what keeps the notification (and back-press) alive. */
  @Volatile
  var isActive: Boolean = false
    private set

  @Volatile
  var isPlaying: Boolean = false
    private set

  // ── lifecycle ────────────────────────────────────────────────────────────

  /**
   * Called by `MediaPlugin.setEventHandler` — Rust installs the channel
   * during app startup, before the page can push anything.
   */
  fun attach(activity: Activity, channel: Channel) {
    this.activity = activity
    this.appContext = activity.applicationContext
    this.channel = channel
    starting = false
    // The page may have booted before the channel existed — ask it to
    // re-publish whatever is playing right now.
    main.postDelayed({ send(CMD_SYNC) }, 250)
  }

  /** Called from `MainActivity.onDestroy` — the WebView goes with it. */
  fun detach() {
    main.removeCallbacksAndMessages(null)
    activity = null
    state = null
    isActive = false
    isPlaying = false
    starting = false
    appContext?.let { it.stopService(Intent(it, PlaybackService::class.java)) }
    appContext = null
  }

  /** The page's latest payload, as the service should render it. */
  fun snapshot(): JSONObject? = state

  // ── web → native (the `media` plugin's commands land here) ──────────────

  /** Track facts (`plugin:media|update_media_metadata`). */
  fun publishMetadata(args: MediaMetadataArgs) {
    main.post {
      val payload = stateOrEmpty()
      payload.put("title", args.title ?: "")
      payload.put("artist", args.artist ?: "")
      payload.put("album", args.album ?: "")
      payload.put("artwork", args.artworkUrl ?: "")
      args.duration?.let { payload.put("duration", it) }
      publish(payload)
    }
  }

  /** Transport facts (`plugin:media|update_playback_state`). */
  fun publishState(args: PlaybackStateArgs) {
    main.post {
      val payload = stateOrEmpty()
      payload.put("active", args.active)
      payload.put("playing", args.active && args.playing)
      args.position?.let { payload.put("position", it) }
      args.duration?.let { payload.put("duration", it) }
      publish(payload)
    }
  }

  /** Merges into the running document so the two pushes never clobber. */
  private fun stateOrEmpty(): JSONObject =
    state ?: JSONObject().put("active", false).put("playing", false)

  private fun publish(payload: JSONObject) {
    // A push that races the teardown must not resurrect the service with a
    // WebView that can no longer answer it.
    if (appContext == null) return
    state = payload
    val active = payload.optBoolean("active", false)
    isActive = active
    isPlaying = active && payload.optBoolean("playing", false)

    val service = PlaybackService.instance
    if (active) {
      starting = false
      ensureNotificationPermission()
      if (service == null) startService()
      service?.applyState(payload)
    } else {
      starting = false
      appContext?.let { it.stopService(Intent(it, PlaybackService::class.java)) }
    }
  }

  private fun startService() {
    if (starting) return
    val context = appContext ?: return
    starting = true
    try {
      ContextCompat.startForegroundService(
        context,
        Intent(context, PlaybackService::class.java),
      )
    } catch (error: Exception) {
      // API 31+ refuses background starts; a play always originates in the
      // foreground, so this only bites on OEMs that tighten the rules —
      // the app keeps playing, it simply gets no shade controls.
      starting = false
      return
    }
    // Never let a failed start wedge every later attempt.
    main.postDelayed({ starting = false }, 5_000)
  }

  /** Android 13+: the media card needs the notification permission. */
  private fun ensureNotificationPermission() {
    val target = activity ?: return
    if (askedNotificationPermission) return
    askedNotificationPermission = true
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    if (ContextCompat.checkSelfPermission(target, Manifest.permission.POST_NOTIFICATIONS) ==
      PackageManager.PERMISSION_GRANTED
    ) {
      return
    }
    try {
      ActivityCompat.requestPermissions(
        target,
        arrayOf(Manifest.permission.POST_NOTIFICATIONS),
        NOTIFICATION_PERMISSION_REQUEST,
      )
    } catch (error: Exception) {
      // The activity is not in a launchable state — the controls still
      // work on the lock screen of most devices without it.
    }
  }

  // ── native → web ─────────────────────────────────────────────────────────

  /**
   * Run a command in the page and keep the shade honest until the echo
   * lands: a backgrounded WebView may throttle its own events, so the
   * optimistic patch (below) is what the user sees immediately.
   */
  fun command(action: String, value: Double? = null) {
    send(action, value)
    val payload = state ?: return
    when (action) {
      CMD_PLAY -> payload.put("playing", true)
      CMD_PAUSE, CMD_STOP -> payload.put("playing", false)
      CMD_TOGGLE -> payload.put("playing", !payload.optBoolean("playing", false))
      CMD_SEEK -> if (value != null) payload.put("position", value)
      else -> Unit
    }
    isActive = payload.optBoolean("active", false)
    isPlaying = isActive && payload.optBoolean("playing", false)
    PlaybackService.instance?.applyState(payload)
    if (action != CMD_SYNC) {
      main.postDelayed({ send(CMD_SYNC) }, ECHO_DELAY_MS)
    }
  }

  private fun send(action: String, value: Double? = null) {
    val target = channel ?: return
    val payload = JSObject()
    payload.put("action", action)
    if (value != null) payload.put("value", value)
    main.post {
      try {
        target.send(payload)
      } catch (error: Exception) {
        // the channel died between the null-check and the send
      }
    }
  }
}
