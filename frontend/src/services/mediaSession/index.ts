import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { localArtworkDataUrl } from "../../offline/source";
import {
  setMediaControlHandler,
  updateNativeMediaSession,
} from "../../platform/androidMedia";
import { DEFAULT_SETTINGS, getSettingsSnapshot, subscribeSettings } from "../../settings/store";
import type { Track, TrackMeta } from "../../types/models";
import { syncedLines } from "../../utils/lyrics";

/**
 * System level playback — macOS Now Playing / Control Center, Windows media
 * controls, Android lock screens — through the Web Media Session API. One
 * manager owns everything the OS is told about this
 * app's audio.
 *
 * The module is deliberately defensive: every entry point is feature
 * detected, every call the browser may refuse is wrapped, and the handlers
 * are registered **once** while reading the latest callbacks through a ref.
 *
 * When the active song has been downloaded, its **local** cover (base64 data
 * URL read straight from the app sandbox) is handed to the OS first, so the
 * widget keeps working with no network at all.
 *
 * Lock-screen lyrics (`lockScreenLyrics.ts`) additionally repaint
 * `metadata.artist` with the currently sung line — all without touching
 * React state per tick.
 */

import {
  LYRIC_LINE_PREFIX,
  useLockScreenLyricTracker,
} from './lockScreenLyrics';
import { isIOS } from '../env';

const YTIMG = 'https://i.ytimg.com';

/**
 * Actions whose *labels* decide what the lock screen / widget shows:
 *
 * - macOS maps `seekbackward` / `seekforward` to the widget's skip buttons
 *   and labels them "5 seconds back / forward", replacing the ⏮ ⏭ track
 *   buttons.
 * - iOS / iPadOS does the same thing with "previous / next 10 seconds"
 *   buttons whenever those two actions are handled.
 *
 * Skipping both registrations keeps previous/next **track** on the widget
 * there, while Android / Windows still get their native seek buttons.
 */
const isMacOS = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '');
const keepsTrackButtons = isMacOS || isIOS;

/** Actions the widget can send; unsupported ones are dropped one by one. */
const ACTIONS: MediaSessionAction[] = keepsTrackButtons
  ? ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto']
  : [
      'play',
      'pause',
      'previoustrack',
      'nexttrack',
      'seekto',
      'seekbackward',
      'seekforward',
    ];

/** Seconds `seekbackward` / `seekforward` jump when the OS names no step. */
const SEEK_STEP = 10;

/** Position state is pushed at most once a second. */
const POSITION_INTERVAL = 1000;

/** Events that change the shape of the widget and must land immediately. */
const IMMEDIATE_EVENTS = [
  'play',
  'pause',
  'seeked',
  'loadedmetadata',
  'durationchange',
  'ratechange',
] as const;

/**
 * The same set (plus `ended`) mirrored to the **native** Android session —
 * the queue advancing on its own is exactly the moment the notification's
 * title and play button have to be repainted.
 */
const ANDROID_MIRROR_EVENTS = [...IMMEDIATE_EVENTS, 'ended'] as const;

function session(): MediaSession | undefined {
  return typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
}

/**
 * Center-crops an image data URL to a 1:1 square.
 *
 * The sandboxed cover keeps the original aspect ratio (16:9 video thumbs
 * included), which macOS renders with letterboxing in the media widget — so
 * whatever we hand to the OS is squared first. The square's side comes back
 * too, so the entry can carry a real `sizes` and outrank the CDN thumbnails
 * in the widget's own largest-first pick. Returns the input unchanged (with
 * no size) when the image cannot be decoded.
 */
async function squareArtwork(dataUrl: string): Promise<{ url: string; side: number }> {
  try {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const { naturalWidth: w, naturalHeight: h } = image;
    if (!w || !h) return { url: dataUrl, side: 0 };
    if (w === h) return { url: dataUrl, side: w };
    const side = Math.min(w, h);
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { url: dataUrl, side: 0 };
    ctx.drawImage(image, (w - side) / 2, (h - side) / 2, side, side, 0, 0, side, side);
    return { url: canvas.toDataURL('image/jpeg', 0.9), side };
  } catch {
    return { url: dataUrl, side: 0 };
  }
}

function audioOf(audioRef: React.RefObject<HTMLAudioElement | null>): HTMLAudioElement | null {
  return audioRef?.current || null;
}

/** `true` for a usable, positive pixel count in a `"512x512"` string. */
function areaOf(sizes: string): number {
  const match = /^(\d+)x(\d+)$/.exec(String(sizes || ''));
  if (!match) return 0;
  return Number(match[1]) * Number(match[2]);
}

interface ArtworkEntry {
  src: string;
  sizes?: string;
  type?: string;
}

/** A downloaded song's cover: the square-cropped data URL + its pixel side. */
interface LocalCover {
  url: string;
  side: number;
}

/**
 * Artwork candidates for the widget: as many real resolutions as the payload
 * offers, topped up with the known sizes of the `i.ytimg.com` CDN.
 * JPEG only — the WebP twin some browsers refuse to paint is never used.
 *
 * A downloaded song's cover replaces the CDN trio entirely: the sandbox
 * holds the best size that ever existed for it, so the widget must not
 * rank a remote (possibly 404-walking) thumbnail above the file the app
 * itself renders.
 */
function buildArtwork(
  track: Track | null,
  meta: TrackMeta | null,
  localCover: LocalCover | null,
): ArtworkEntry[] {
  const entries: ArtworkEntry[] = [];

  // The downloaded cover wins: it needs no network and is what offline
  // playback actually renders. The square's side is attached so the entry
  // outranks the CDN thumbnails in the widget's largest-first pick.
  if (localCover) {
    entries.push({
      src: localCover.url,
      ...(localCover.side ? { sizes: `${localCover.side}x${localCover.side}` } : null),
      type: 'image/jpeg',
    });
  }

  const seen = new Set<string>();
  const add = (url: unknown, width: unknown, height: unknown) => {
    if (typeof url !== 'string' || !/^https?:/.test(url)) return;
    if (/\.webp([?#]|$)/i.test(url)) return;
    if (seen.has(url)) return;
    const w = Number(width);
    const h = Number(height);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
    seen.add(url);
    entries.push({ src: url, sizes: `${w}x${h}`, type: 'image/jpeg' });
  };

  const sources = [
    meta?.thumbnails,
    (meta?.album as { thumbnails?: unknown } | undefined)?.thumbnails,
    meta?.artwork,
    track?.artwork,
  ];
  for (const source of sources) {
    const thumbs = Array.isArray(source) ? source : (source as { thumbnails?: unknown })?.thumbnails;
    if (!Array.isArray(thumbs)) continue;
    thumbs.forEach((thumb) =>
      add(
        (thumb as { url?: string })?.url,
        (thumb as { width?: number })?.width,
        (thumb as { height?: number })?.height,
      ),
    );
  }

  if (track?.videoId && !localCover) {
    add(`${YTIMG}/vi/${track.videoId}/maxresdefault.jpg`, 1280, 720);
    add(`${YTIMG}/vi/${track.videoId}/sddefault.jpg`, 640, 480);
    add(`${YTIMG}/vi/${track.videoId}/hqdefault.jpg`, 480, 360);
  }

  return entries.sort((a, b) => areaOf(b.sizes ?? '') - areaOf(a.sizes ?? '')).slice(0, 6);
}

/** `MediaMetadata` payload for the active track. */
export function buildMetadata(
  track: Track | null,
  meta: TrackMeta | null,
  localCover: LocalCover | null = null,
): MediaMetadataInit {
  return {
    title: track?.title || 'Unknown title',
    artist: track?.artist || 'Unknown artist',
    album:
      (typeof meta?.album === 'object' ? meta.album.name : undefined) ||
      track?.albumName ||
      '',
    artwork: buildArtwork(track, meta, localCover) as MediaImage[],
  };
}

export interface MediaSessionParams {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  current: Track | null;
  meta: TrackMeta | null;
  isPlaying: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
}

export function useMediaSession({
  audioRef,
  current,
  meta,
  isPlaying,
  onPrevious,
  onNext,
  onSeek,
}: MediaSessionParams): void {
  const media = session();
  const videoId = current?.videoId ?? null;

  // Local cover of a downloaded song, resolved asynchronously.
  const [localCover, setLocalCover] = useState<LocalCover | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!videoId) {
      setLocalCover(null);
      return () => {
        cancelled = true;
      };
    }
    void localArtworkDataUrl(videoId)
      .then((url) => (url ? squareArtwork(url) : null))
      .then((cover) => {
        if (!cancelled) setLocalCover(cover);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  // ── 1. Metadata (title / artist / album / artwork, plus the lock-screen
  //        lyric mirror on the artist slot) ────────────────────────────────

  const lockLyricsEnabled = useSyncExternalStore(
    subscribeSettings,
    () => getSettingsSnapshot().lockScreenLyrics,
    () => DEFAULT_SETTINGS.lockScreenLyrics,
  );

  // Currently sung line, mirrored from `timeupdate` without React state —
  // `publishMetadata` below repaints the OS widget directly per line change.
  const lyricLineRef = useRef<string | null>(null);

  // A new song starts from the plain artist; declared *before* the publish
  // effect so the reset lands within the same commit.
  useEffect(() => {
    lyricLineRef.current = null;
  }, [videoId]);

  // Same metadata-preferred duration as the player (see PlayerContext): the
  // element's own number is only the fallback, never the source of truth.
  // Declared before the lyric tracker and the Android push, which both read
  // it (§4's position effect does too).
  const trustedDuration = current?.durationSeconds || meta?.duration_seconds || 0;

  // ── Android: the native media session (Tauri `media` plugin) ────────────
  // Android WebView has no `navigator.mediaSession`, so the shade /
  // lock-screen card there is a Kotlin media3 MediaSession + foreground
  // service (gen/android/…/media/). It is fed the same facts the Web API
  // consumes — including the currently sung lyric line on the artist slot —
  // and calls back into the handlers of §3; see `platform/androidMedia` for
  // the wire format. Everywhere else (and under plain `vite dev`) these
  // pushes are no-ops.

  /** One payload: whatever the element says beats whatever state says. */
  const publishAndroidMedia = useCallback(() => {
    const audio = audioOf(audioRef);
    const base = current ? buildMetadata(current, meta, localCover) : null;
    const duration = trustedDuration || (audio && audio.duration > 0 ? audio.duration : 0);
    const line = lockLyricsEnabled ? lyricLineRef.current : null;
    updateNativeMediaSession({
      title: base?.title ?? '',
      artist: line
        ? LYRIC_LINE_PREFIX
          ? `${LYRIC_LINE_PREFIX} ${line}`
          : line
        : (base?.artist ?? ''),
      album: base?.album ?? '',
      artworkUrl: base?.artwork?.[0]?.src ?? null,
      duration: duration || undefined,
      active: Boolean(current),
      isPlaying: Boolean(current) && (audio ? !audio.paused : isPlaying),
      position: audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
    });
  }, [audioRef, current, meta, localCover, isPlaying, trustedDuration, lockLyricsEnabled]);

  const publishMetadata = useCallback(() => {
    if (!media || typeof MediaMetadata !== 'function') return;
    if (!current) {
      media.metadata = null;
      return;
    }
    const base = buildMetadata(current, meta, localCover);
    const line = lockLyricsEnabled ? lyricLineRef.current : null;
    media.metadata = new MediaMetadata(
      line ? { ...base, artist: LYRIC_LINE_PREFIX ? `${LYRIC_LINE_PREFIX} ${line}` : line, album: undefined } : base,
    );
  }, [media, current, meta, localCover, lockLyricsEnabled]);

  useEffect(() => {
    publishMetadata();
  }, [publishMetadata]);

  useLockScreenLyricTracker({
    audioRef,
    lines: syncedLines(meta),
    enabled: lockLyricsEnabled,
    onLine: useCallback(
      (line: string | null) => {
        lyricLineRef.current = line;
        // The Web widget's artist slot and the native card repaint together
        // so the lyric line lands on both lock screens at once.
        publishMetadata();
        publishAndroidMedia();
      },
      [publishMetadata, publishAndroidMedia],
    ),
  });

  // ── 2. Playback state ───────────────────────────────────────────────────
  useEffect(() => {
    if (!media || !('playbackState' in media)) return;
    media.playbackState = !current ? 'none' : isPlaying ? 'playing' : 'paused';
  }, [media, current, isPlaying]);

  // Latest callbacks, without ever re-registering the system handlers.
  const actions = useRef<{
    onPrevious?: () => void;
    onNext?: () => void;
    onSeek?: (time: number) => void;
  }>({});
  useEffect(() => {
    actions.current = { onPrevious, onNext, onSeek };
  });

  // ── 3. Action handlers ──────────────────────────────────────────────────
  useEffect(() => {
    if (!media) return undefined;

    const handlers: Record<string, (details?: MediaSessionActionDetails) => void> = {
      play: () => {
        const attempt = audioOf(audioRef)?.play();
        if (attempt) attempt.catch(() => {});
      },
      pause: () => audioOf(audioRef)?.pause(),
      previoustrack: () => actions.current.onPrevious?.(),
      nexttrack: () => actions.current.onNext?.(),
      seekto: (details) => {
        const time = Number(details?.seekTime);
        if (!Number.isFinite(time)) return;
        actions.current.onSeek?.(time);
      },
      seekbackward: (details) => {
        const audio = audioOf(audioRef);
        if (!audio) return;
        const step = Number(details?.seekOffset) > 0 ? Number(details!.seekOffset) : SEEK_STEP;
        actions.current.onSeek?.(Math.max(0, audio.currentTime - step));
      },
      seekforward: (details) => {
        const audio = audioOf(audioRef);
        if (!audio) return;
        const step = Number(details?.seekOffset) > 0 ? Number(details!.seekOffset) : SEEK_STEP;
        const limit =
          Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Infinity;
        actions.current.onSeek?.(Math.min(limit, audio.currentTime + step));
      },
    };

    const registered: MediaSessionAction[] = [];
    for (const action of ACTIONS) {
      try {
        media.setActionHandler(action, handlers[action] as (d: MediaSessionActionDetails) => void);
        registered.push(action);
      } catch {
        // an action this browser does not implement (seekto on older Safari)
      }
    }

    return () => {
      for (const action of registered) {
        try {
          media.setActionHandler(action, null);
        } catch {
          /* nothing to unbind on a browser that rejected it */
        }
      }
    };
  }, [media, audioRef]);

  // ── 4. Position state ───────────────────────────────────────────────────
  useEffect(() => {
    const audio = audioOf(audioRef);
    if (!media || !audio || typeof media.setPositionState !== 'function') return undefined;

    let timer = 0;
    let lastPushed = 0;

    const clear = () => {
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
      try {
        media.setPositionState();
      } catch {
        /* older Safari refuses an empty reset */
      }
    };

    const push = () => {
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
      const element = audioOf(audioRef);
      if (!element) return;
      const duration =
        trustedDuration ||
        (Number.isFinite(element.duration) && element.duration > 0
          ? element.duration
          : NaN);
      if (!Number.isFinite(duration) || duration <= 0) {
        clear();
        return;
      }
      const position = Math.min(Math.max(0, element.currentTime), duration);
      const rate = element.playbackRate;
      try {
        media.setPositionState({
          duration,
          playbackRate: Number.isFinite(rate) && rate !== 0 ? rate : 1,
          position,
        });
        lastPushed = Date.now();
      } catch {
        /* the browser refused this state */
      }
    };

    const onClock = () => {
      if (timer) return;
      const wait = Math.max(0, POSITION_INTERVAL - (Date.now() - lastPushed));
      timer = window.setTimeout(push, wait);
    };

    IMMEDIATE_EVENTS.forEach((name) => audio.addEventListener(name, push));
    audio.addEventListener('timeupdate', onClock);
    push();

    return () => {
      IMMEDIATE_EVENTS.forEach((name) => audio.removeEventListener(name, push));
      audio.removeEventListener('timeupdate', onClock);
      if (timer) clearTimeout(timer);
      try {
        media.setPositionState();
      } catch {
        /* ignore */
      }
    };
  }, [media, audioRef, videoId, trustedDuration]);

  // ── 5. Teardown ─────────────────────────────────────────────────────────
  useEffect(
    () => () => {
      if (!media) return;
      media.metadata = null;
      if ('playbackState' in media) media.playbackState = 'none';
    },
    [media],
  );

  // ── 6. Android pushes + button echo ─────────────────────────────────────
  // The payload lives above §1 (the lyric tracker repaints through it too);
  // this side only wires the triggers.

  // Track changes, metadata resolution, play/pause flips.
  useEffect(() => {
    publishAndroidMedia();
  }, [publishAndroidMedia]);

  // Element-side events (seek, stall, natural end) land immediately — a
  // seek while paused changes nothing the effect above depends on.
  useEffect(() => {
    const audio = audioOf(audioRef);
    if (!audio) return undefined;
    const onEvent = () => publishAndroidMedia();
    ANDROID_MIRROR_EVENTS.forEach((name) => audio.addEventListener(name, onEvent));
    return () => {
      ANDROID_MIRROR_EVENTS.forEach((name) => audio.removeEventListener(name, onEvent));
    };
  }, [audioRef, videoId, publishAndroidMedia]);

  // Shade / lock-screen buttons → the very handlers the Web Media Session
  // would drive, through the latest-callbacks ref so nothing re-registers.
  useEffect(() => {
    setMediaControlHandler((action, value) => {
      const audio = audioOf(audioRef);
      switch (action) {
        case 'play': {
          const attempt = audio?.play();
          if (attempt) attempt.catch(() => {});
          break;
        }
        case 'toggle': {
          if (!audio) break;
          if (audio.paused) {
            const attempt = audio.play();
            attempt.catch(() => {});
          } else {
            audio.pause();
          }
          break;
        }
        case 'pause':
        case 'stop':
          audio?.pause();
          break;
        case 'next':
          actions.current.onNext?.();
          break;
        case 'previous':
          actions.current.onPrevious?.();
          break;
        case 'seek':
          if (Number.isFinite(value)) actions.current.onSeek?.(value as number);
          break;
        default:
          break;
      }
    });
    return () => setMediaControlHandler(null);
  }, [audioRef]);
}
