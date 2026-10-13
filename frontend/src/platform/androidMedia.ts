/**
 * Android media-session bridge — the Tauri IPC half.
 *
 * Android's System WebView ships no `navigator.mediaSession` (Blink's
 * trackers are still open — see DEVELOPMENT.md, "Known Android WebView
 * gaps"), so the shade / quick-settings / lock-screen card there is a
 * native media3 `MediaSession` living in a foreground service
 * (`src-tauri/gen/android/app/src/main/java/com/z44d/carmen/media/`).
 * The two sides meet in the in-app Tauri `media` plugin:
 *
 *   web → native   `plugin:media|update_media_metadata` and
 *                  `plugin:media|update_playback_state` — Rust commands
 *                  (`src-tauri/src/media.rs`) forwarded to Kotlin.
 *   native → web   `media-control:<action>` events, emitted by Rust for
 *                  every notification / lock-screen / headset button.
 *
 * Everything here is best-effort: under a plain `vite dev` server nothing
 * is pushed at all, and on desktop the commands reach Rust and turn into
 * silent no-ops — the Web Media Session API owns those platforms.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import { isTauri } from './env';

/** What the native side is told about playback. Seconds, not milliseconds. */
export interface NativeMediaMetadata {
  /** Track title. */
  title: string;
  /**
   * Artist — or the currently sung lyric line when lock-screen lyrics are
   * on (`lockScreenLyrics.ts` mirrors it into this slot on every platform).
   */
  artist: string;
  album?: string;
  /** Best cover candidate: an https URL or a `data:` URL for a downloaded song. */
  artworkUrl?: string | null;
  /** Trusted track length in seconds. */
  duration?: number;

  // Transport facts, folded in so one call repaints the whole card:
  /** A track is loaded — decides whether the media notification exists. */
  active?: boolean;
  isPlaying?: boolean;
  position?: number;
}

/** Commands the native side can send (notification / lock-screen buttons). */
export type MediaControlAction =
  | 'play'
  | 'pause'
  | 'toggle'
  | 'next'
  | 'previous'
  | 'seek'
  | 'stop'
  /** The native side lost its cached state (service restart) — re-push it. */
  | 'sync';

type ControlHandler = (action: MediaControlAction, value?: number) => void;

const ACTIONS: readonly MediaControlAction[] = [
  'play',
  'pause',
  'toggle',
  'next',
  'previous',
  'seek',
  'stop',
  'sync',
];

let handler: ControlHandler | null = null;
let listening = false;

/** Last payload pushed — replayed verbatim when native asks for a `sync`. */
let last: NativeMediaMetadata | null = null;

function push(
  command: 'update_media_metadata' | 'update_playback_state',
  payload: Record<string, unknown>,
): void {
  if (!isTauri) return;
  void invoke(`plugin:media|${command}`, payload).catch(() => {
    /* the native side is gone (dev server, desktop no-op) — next push retries */
  });
}

/**
 * Web → native: publish what is playing. The transport fields (`active`,
 * `isPlaying`, `position`) travel with the metadata, so a single call
 * repaints the whole shade / lock-screen card.
 */
export function updateNativeMediaSession(metadata: NativeMediaMetadata): void {
  last = metadata;
  const { title, artist, album, artworkUrl, duration, active, isPlaying, position } = metadata;
  push('update_media_metadata', {
    metadata: { title, artist, album, artworkUrl, duration },
  });
  if (active !== undefined || isPlaying !== undefined || position !== undefined) {
    push('update_playback_state', {
      playback: {
        active: active ?? false,
        playing: isPlaying ?? false,
        position,
        duration,
      },
    });
  }
}

/**
 * Native → web: route shade / lock-screen / headset buttons into `handler`.
 * Registered once by `useMediaSession`; repeated calls only swap the
 * callback, passing `null` silences the bridge.
 */
export function setMediaControlHandler(next: ControlHandler | null): void {
  handler = next;
  if (!next || listening || !isTauri) return;
  listening = true;
  for (const action of ACTIONS) {
    void listen<number | null>(`media-control:${action}`, (event) => {
      if (action === 'sync') {
        if (last) updateNativeMediaSession(last);
        return;
      }
      try {
        handler?.(action, typeof event.payload === 'number' ? event.payload : undefined);
      } catch {
        /* one bad command must never take the bridge down */
      }
    }).catch(() => {
      listening = false;
    });
  }
}
