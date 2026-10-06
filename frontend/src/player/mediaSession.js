/**
 * System level playback — macOS Now Playing / Control Center, Windows media
 * controls, Android lock screens — through the Web Media Session API.
 *
 * The module is deliberately defensive: every entry point is feature
 * detected, every call the browser may refuse (an action a Safari build does
 * not implement, a position state it cannot make sense of) is wrapped, and
 * the handlers are registered **once** while reading the latest callbacks
 * through a ref.  A browser without `navigator.mediaSession` simply gets no
 * widget and the player behaves exactly as before.
 */
import { useEffect, useRef } from 'react';

const YTIMG = 'https://i.ytimg.com';

/** Actions the widget can send; unsupported ones are dropped one by one. */
const ACTIONS = [
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

/** Position state is pushed at most once a second; the clock is the only
 * source that fires often enough to need throttling. */
const POSITION_INTERVAL = 1000;

/** Events that change the shape of the widget and must land immediately. */
const IMMEDIATE_EVENTS = [
  'play',
  'pause',
  'seeked',
  'loadedmetadata',
  'durationchange',
  'ratechange',
];

function session() {
  return typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
}

/** The `<audio>` element, or null when the player has not mounted yet. */
function audioOf(audioRef) {
  return audioRef?.current || null;
}

/** `true` for a usable, positive pixel count in a `"512x512"` string. */
function areaOf(sizes) {
  const match = /^(\d+)x(\d+)$/.exec(String(sizes || ''));
  if (!match) return 0;
  return Number(match[1]) * Number(match[2]);
}

/**
 * Artwork candidates for the widget: as many **real** resolutions as the
 * payload offers, topped up with the three known sizes of the `i.ytimg.com`
 * CDN so a song without metadata still gets a small / medium / large set.
 *
 * Sizes are the dimensions the images actually have — the OS picks the
 * closest one — and JPEG only, the same rule the UI follows (the WebP twin
 * some browsers refuse to paint is never used).
 *
 * @returns {Array<{src: string, sizes: string, type: string}>}
 */
function buildArtwork(track, meta) {
  const seen = new Set();
  const entries = [];

  const add = (url, width, height) => {
    if (typeof url !== 'string' || !/^https?:/.test(url)) return;
    if (/\.webp([?#]|$)/i.test(url)) return;
    if (seen.has(url)) return;
    const w = Number(width);
    const h = Number(height);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
    seen.add(url);
    entries.push({ src: url, sizes: `${w}x${h}`, type: 'image/jpeg' });
  };

  // The API answers with thumbnails in several shapes — an array, or an
  // object holding one (both are accepted by the rest of the app).
  const sources = [meta?.thumbnails, meta?.album?.thumbnails, meta?.artwork, track?.artwork];
  for (const source of sources) {
    const thumbs = Array.isArray(source) ? source : source?.thumbnails;
    if (!Array.isArray(thumbs)) continue;
    thumbs.forEach((thumb) => add(thumb?.url, thumb?.width, thumb?.height));
  }

  if (track?.videoId) {
    add(`${YTIMG}/vi/${track.videoId}/maxresdefault.jpg`, 1280, 720);
    add(`${YTIMG}/vi/${track.videoId}/sddefault.jpg`, 640, 480);
    add(`${YTIMG}/vi/${track.videoId}/hqdefault.jpg`, 480, 360);
  }

  return entries.sort((a, b) => areaOf(b.sizes) - areaOf(a.sizes)).slice(0, 6);
}

/**
 * `MediaMetadata` payload for the active track.
 *
 * Missing fields fall back to the normalized track, which already carries
 * "Unknown title" / "Unknown artist" when the API left them empty.
 *
 * @param {object|null} track normalized track (see `utils/track.js`)
 * @param {object|null} meta enriched payload from `/browsing/track/{id}`
 * @returns {{title: string, artist: string, album: string, artwork: Array}}
 */
export function buildMetadata(track, meta) {
  return {
    title: track?.title || 'Unknown title',
    artist: track?.artist || 'Unknown artist',
    album: meta?.album?.name || track?.albumName || '',
    artwork: buildArtwork(track, meta),
  };
}

/**
 * Wire the player's `<audio>` element up to `navigator.mediaSession`.
 *
 * @param {object} params
 * @param {React.RefObject<HTMLAudioElement>} params.audioRef the player element
 * @param {object|null} params.current active track
 * @param {object|null} params.meta enriched metadata of the active track
 * @param {boolean} params.isPlaying audio is currently playing
 * @param {() => void} params.onPrevious app "previous track"
 * @param {() => void} params.onNext app "next track"
 * @param {(seconds: number) => void} params.onSeek app seek (keeps the UI in sync)
 */
export function useMediaSession({
  audioRef,
  current,
  meta,
  isPlaying,
  onPrevious,
  onNext,
  onSeek,
}) {
  const media = session();

  // ── 1. Metadata ─────────────────────────────────────────────────────────
  // Rebuilt when the track changes *and* again once the enriched payload
  // lands, so the widget shows the song immediately and the album after.
  useEffect(() => {
    if (!media || typeof MediaMetadata !== 'function') return;
    if (!current) {
      media.metadata = null;
      return;
    }
    media.metadata = new MediaMetadata(buildMetadata(current, meta));
  }, [media, current, meta]);

  // ── 2. Playback state ───────────────────────────────────────────────────
  useEffect(() => {
    if (!media || !('playbackState' in media)) return;
    media.playbackState = !current ? 'none' : isPlaying ? 'playing' : 'paused';
  }, [media, current, isPlaying]);

  // Latest callbacks, without ever re-registering the system handlers: the
  // handlers registered below must not capture a stale `previous`/`next`.
  const actions = useRef({});
  useEffect(() => {
    actions.current = { onPrevious, onNext, onSeek };
  });

  // ── 3. Action handlers ──────────────────────────────────────────────────
  useEffect(() => {
    if (!media) return undefined;

    const handlers = {
      // Safari only allows play() from a user gesture the first time; every
      // later call (media keys, widget) rides on the playback that a click
      // already started, and a refusal must not throw an unhandled rejection.
      play: () => {
        const audio = audioOf(audioRef);
        const attempt = audio?.play();
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
        const step = Number(details?.seekOffset) > 0 ? Number(details.seekOffset) : SEEK_STEP;
        actions.current.onSeek?.(Math.max(0, audio.currentTime - step));
      },
      seekforward: (details) => {
        const audio = audioOf(audioRef);
        if (!audio) return;
        const step = Number(details?.seekOffset) > 0 ? Number(details.seekOffset) : SEEK_STEP;
        const limit = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Infinity;
        actions.current.onSeek?.(Math.min(limit, audio.currentTime + step));
      },
    };

    const registered = [];
    for (const action of ACTIONS) {
      try {
        media.setActionHandler(action, handlers[action]);
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
  // `timeupdate` fires several times a second: pushing every tick would keep
  // the main thread busy for no visible gain, so the clock is throttled to
  // one update a second while play / pause / seek land straight away.
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
        media.setPositionState(); // no argument resets the widget
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
        /* the browser refused this state — nothing the user can act on */
      }
    };

    const onClock = () => {
      if (timer) return;
      const wait = Math.max(0, POSITION_INTERVAL - (Date.now() - lastPushed));
      timer = setTimeout(push, wait);
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
  }, [media, audioRef, current?.videoId]);

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
