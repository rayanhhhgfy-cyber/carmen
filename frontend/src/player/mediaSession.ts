/**
 * System level playback — macOS Now Playing / Control Center, Windows media
 * controls, Android lock screens — through the Web Media Session API.
 *
 * The module is deliberately defensive: every entry point is feature
 * detected, every call the browser may refuse is wrapped, and the handlers
 * are registered **once** while reading the latest callbacks through a ref.
 *
 * When the active song has been downloaded, its **local** cover (base64 data
 * URL read straight from the app sandbox) is handed to the OS first, so the
 * widget keeps working with no network at all.
 */
import { useEffect, useRef, useState } from 'react';

import { localArtworkDataUrl } from '../offline/source';
import type { Track, TrackMeta } from '../types/models';

const YTIMG = 'https://i.ytimg.com';

/** Actions the widget can send; unsupported ones are dropped one by one. */
const ACTIONS: MediaSessionAction[] = [
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

function session(): MediaSession | undefined {
  return typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
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

/**
 * Artwork candidates for the widget: as many real resolutions as the payload
 * offers, topped up with the known sizes of the `i.ytimg.com` CDN.
 * JPEG only — the WebP twin some browsers refuse to paint is never used.
 */
function buildArtwork(
  track: Track | null,
  meta: TrackMeta | null,
  localCover: string | null,
): ArtworkEntry[] {
  const entries: ArtworkEntry[] = [];

  // The downloaded cover wins: it needs no network and is what offline
  // playback actually renders.
  if (localCover) entries.push({ src: localCover, type: 'image/jpeg' });

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

  if (track?.videoId) {
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
  localCover: string | null = null,
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
  const [localCover, setLocalCover] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!videoId) {
      setLocalCover(null);
      return () => {
        cancelled = true;
      };
    }
    void localArtworkDataUrl(videoId)
      .then((url) => {
        if (!cancelled) setLocalCover(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  // ── 1. Metadata ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!media || typeof MediaMetadata !== 'function') return;
    if (!current) {
      media.metadata = null;
      return;
    }
    media.metadata = new MediaMetadata(buildMetadata(current, meta, localCover));
  }, [media, current, meta, localCover]);

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
      const duration = element.duration;
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
  }, [media, audioRef, videoId]);

  // ── 5. Teardown ─────────────────────────────────────────────────────────
  useEffect(
    () => () => {
      if (!media) return;
      media.metadata = null;
      if ('playbackState' in media) media.playbackState = 'none';
    },
    [media],
  );
}
