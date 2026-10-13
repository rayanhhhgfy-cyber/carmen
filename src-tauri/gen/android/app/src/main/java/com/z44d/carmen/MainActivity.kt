package com.z44d.carmen

import android.os.Bundle
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import com.z44d.carmen.media.MediaBridge

class MainActivity : TauriActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Back must not tear the player down. With a track loaded the activity
    // simply steps aside — the WebView keeps playing and the media
    // notification (shade / quick settings / lock screen) keeps working.
    // With nothing loaded the default finish() applies, as before.
    onBackPressedDispatcher.addCallback(
      this,
      object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          if (MediaBridge.isActive) {
            moveTaskToBack(false)
            return
          }
          isEnabled = false
          onBackPressed()
          isEnabled = true
        }
      },
    )
  }

  override fun onDestroy() {
    // The WebView is the player: once it goes, the media service and its
    // notification have nothing left to mirror. (The web↔native channel
    // itself is owned by the `media` Tauri plugin and lives for the whole
    // process — see MediaPlugin.kt.)
    MediaBridge.detach()
    super.onDestroy()
  }
}
