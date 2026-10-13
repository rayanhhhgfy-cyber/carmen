package com.z44d.carmen.media

import android.app.PendingIntent
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Base64
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.SimpleBasePlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.z44d.carmen.MainActivity
import org.json.JSONObject
import java.net.URL
import java.util.concurrent.Executors

/**
 * The shade / lock-screen half of the player — a media3
 * [MediaSessionService].
 *
 * The WebView owns the actual audio element (it holds the stream URLs the
 * API deliberately never exposes — see `server/sanitizers.py`), so this
 * service never decodes or plays media: [WebViewPlayer] mirrors the state
 * the page publishes through [MediaBridge] into a media3 `MediaSession`,
 * and the system builds the notification, quick-settings card, lock-screen
 * card, headset and Android Auto controls from it. Every button routes back
 * into the page through [MediaBridge.command].
 *
 * `FOREGROUND_SERVICE_MEDIA_PLAYBACK` is declared in the manifest — the
 * service type is what lets it outlive the activity while audio plays, and
 * media3 starts the foreground itself once a track is active.
 */
class PlaybackService : MediaSessionService() {

  private var mediaSession: MediaSession? = null
  private lateinit var player: WebViewPlayer
  private val main = Handler(Looper.getMainLooper())
  private val artworkExecutor = Executors.newSingleThreadExecutor()

  /** Coalesces artwork downloads: one URL in flight, newest request wins. */
  private var artSource: String? = null
  private var artRequest = 0

  override fun onCreate() {
    super.onCreate()
    instance = this
    player = WebViewPlayer()
    mediaSession = MediaSession.Builder(this, player)
      .setSessionActivity(openAppIntent())
      // The card keeps its playhead ticking between page pushes.
      .setPeriodicPositionUpdateEnabled(true)
      .build()
    // Whatever the bridge cached while the service was starting.
    MediaBridge.snapshot()?.let { applyState(it) }
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

  /**
   * The single entry point for a state push: transport facts into the
   * [WebViewPlayer] (which repaints the notification through media3) and
   * the cover download kicked off — the bytes land on a later repaint,
   * cheap and idempotent.
   */
  fun applyState(json: JSONObject) {
    player.update(json)
    if (!json.optBoolean("active", false)) return
    loadArtwork(json.optString("artwork"))
  }

  // ── Artwork ─────────────────────────────────────────────────────────────

  /**
   * Downloads (or base64-decodes) the cover off the main thread. The URL
   * doubles as the cache key, so a queue of songs from one album fetches
   * once and reuses the bytes for the rest.
   */
  private fun loadArtwork(source: String?) {
    if (source.isNullOrEmpty() || source == artSource) return
    artSource = source
    val request = ++artRequest
    artworkExecutor.execute {
      val bytes = fetchArtwork(source)
      main.post {
        if (request != artRequest) return@post
        // media3's default bitmap loader decodes `artworkData` itself,
        // size-limited — no bitmap ever crosses this boundary.
        player.updateArtwork(bytes)
      }
    }
  }

  /** Raw JPEG/PNG bytes, or null. Capped so a hostile URL cannot OOM us. */
  private fun fetchArtwork(source: String): ByteArray? = try {
    when {
      source.startsWith("data:") ->
        Base64.decode(source.substringAfter("base64,", ""), Base64.DEFAULT)

      source.startsWith("http://") || source.startsWith("https://") ->
        URL(source).openStream().use { it.readBytes() }

      else -> null
    }?.takeIf { it.isNotEmpty() && it.size <= ARTWORK_MAX_BYTES }
  } catch (error: Exception) {
    null
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  override fun onTaskRemoved(rootIntent: Intent?) {
    // The task is gone: the WebView — the real player — dies with it, so a
    // surviving notification would only lie about playback. Stop cleanly.
    stopSelf()
  }

  override fun onDestroy() {
    instance = null
    mediaSession?.run {
      player.release()
      release()
    }
    mediaSession = null
    artworkExecutor.shutdown()
    super.onDestroy()
  }

  private fun openAppIntent(): PendingIntent {
    val intent = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(this, 0, intent, pendingFlags())
  }

  private fun pendingFlags(): Int =
    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT

  companion object {
    /** Hard ceiling for fetched artwork — covers are a few hundred KB. */
    private const val ARTWORK_MAX_BYTES = 8 * 1024 * 1024

    /** Set in onCreate, cleared in onDestroy — how [MediaBridge] reaches us. */
    @Volatile
    var instance: PlaybackService? = null
      private set
  }
}

/**
 * media3's [Player] shape for a player that lives in the WebView.
 *
 * The page is the real player, so this class owns no media at all: every
 * state push from [MediaBridge] becomes a fresh [SimpleBasePlayer.State],
 * and every transport command the system issues — notification, lock
 * screen, headset, Android Auto — is routed back into the page through
 * [MediaBridge.command]. Only the commands implemented here are advertised
 * (media3 throws for advertised commands without a handler), which is also
 * what decides which buttons the system offers.
 */
internal class WebViewPlayer : SimpleBasePlayer(Looper.getMainLooper()) {

  private var active = false
  private var playing = false
  private var positionMs = 0L
  private var durationMs = 0L
  private var title: String = ""
  private var artist: String = ""
  private var album: String = ""
  private var artworkBytes: ByteArray? = null

  /** Mirrors the page's latest state — cheap, idempotent, main thread. */
  fun update(json: JSONObject) {
    active = json.optBoolean("active", false)
    playing = active && json.optBoolean("playing", false)
    positionMs = millis(json.optDouble("position", 0.0))
    durationMs = millis(json.optDouble("duration", 0.0))
    title = json.optString("title")
    artist = json.optString("artist")
    album = json.optString("album")
    invalidateState()
  }

  /** The artwork download landed — repaint the card with the new cover. */
  fun updateArtwork(bytes: ByteArray?) {
    artworkBytes = bytes
    invalidateState()
  }

  override fun getState(): State {
    val metadata = MediaMetadata.Builder()
      .setTitle(title.ifEmpty { null })
      .setArtist(artist.ifEmpty { null })
      .setAlbumTitle(album.ifEmpty { null })
      .setDurationMs(if (durationMs > 0) durationMs else null)
      .apply { artworkBytes?.let { setArtworkData(it) } }
      .build()

    val item = MediaItem.Builder()
      .setMediaId(mediaId())
      .setMediaMetadata(metadata)
      .build()

    val itemData = SimpleBasePlayer.MediaItemData.Builder(ITEM_UID)
      .setMediaItem(item)
      .setMediaMetadata(metadata)
      .setDurationUs(if (durationMs > 0) durationMs * 1000 else C.TIME_UNSET)
      .setIsSeekable(durationMs > 0)
      .build()

    return State.Builder()
      .setAvailableCommands(
        Player.Commands.Builder()
          .add(Player.COMMAND_PLAY_PAUSE)
          .add(Player.COMMAND_STOP)
          .add(Player.COMMAND_RELEASE)
          .add(Player.COMMAND_SEEK_TO_DEFAULT_POSITION)
          .add(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)
          .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
          .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
          .add(Player.COMMAND_GET_CURRENT_MEDIA_ITEM)
          .add(Player.COMMAND_GET_TIMELINE)
          .add(Player.COMMAND_GET_MEDIA_ITEMS_METADATA)
          .build(),
      )
      .setPlaylist(listOf(itemData))
      .setCurrentMediaItemIndex(0)
      .setPlaybackState(if (active) Player.STATE_READY else Player.STATE_IDLE)
      .setPlayWhenReady(playing, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
      // While playing the system extrapolates the playhead from this
      // instant, so the page only has to push on discrete events.
      .setContentPositionMs(
        if (playing) {
          SimpleBasePlayer.PositionSupplier.getExtrapolating(positionMs, 1f)
        } else {
          SimpleBasePlayer.PositionSupplier.getConstant(positionMs)
        },
      )
      .build()
  }

  // ── Transport: system → page ────────────────────────────────────────────

  override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {
    MediaBridge.command(if (playWhenReady) MediaBridge.CMD_PLAY else MediaBridge.CMD_PAUSE)
    return DONE
  }

  override fun handleStop(): ListenableFuture<*> {
    MediaBridge.command(MediaBridge.CMD_PAUSE)
    return DONE
  }

  override fun handleRelease(): ListenableFuture<*> = DONE

  override fun handleSeek(mediaItemIndex: Int, positionMs: Long, command: Int): ListenableFuture<*> {
    when (command) {
      Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> MediaBridge.command(MediaBridge.CMD_NEXT)
      Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> MediaBridge.command(MediaBridge.CMD_PREVIOUS)
      // `C.TIME_UNSET` (Long.MIN_VALUE) means "unspecified" — only real,
      // non-negative targets are forwarded as seeks.
      else -> if (positionMs >= 0) {
        MediaBridge.command(MediaBridge.CMD_SEEK, positionMs / 1000.0)
      }
    }
    return DONE
  }

  private fun mediaId(): String = when {
    title.isNotEmpty() && artist.isNotEmpty() -> "$artist — $title"
    else -> "carmen"
  }

  companion object {
    /** Stable identity for the single mirrored item. */
    private const val ITEM_UID = "carmen"

    /** An already-completed "no pending operation" handle result. */
    private val DONE: ListenableFuture<*> = Futures.immediateFuture(null)

    private fun millis(seconds: Double): Long {
      val safe = if (seconds.isFinite() && seconds > 0) seconds else 0.0
      return (safe * 1000.0).toLong()
    }
  }
}
