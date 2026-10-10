import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

import { apiGet, fetchTrackMeta, streamUrl } from '../api';
import { loadPlayback } from '../db/repos/playback';
import {
  isDownloaded,
  localAssetSource,
  localArtworkDataUrl,
  localBlobSource,
  localLyrics,
  type AudioSource,
} from '../offline/source';
import { emitTrayState, isTauri, onTrayAction } from '../platform/env';
import { useSettings } from '../settings/store';
import type {
  LyricsProvider,
  RepeatMode,
  Track,
  TrackLyrics,
  TrackMeta,
} from '../types/models';
import { addSuggestions, recordPlay } from '../utils/library';
import { normalizeList, normalizeTrack } from '../utils/track';
import { usePlaybackPersistence } from './persistence';
import { useMediaSession } from '../services/mediaSession';
import { useAdaptiveAccent } from '../theme/adaptiveAccent';

/**
 * Playback engine: one <audio> element, a queue, shuffle/repeat, the
 * contextually related list and the enriched metadata of the active track.
 *
 * Offline-first: when the song exists in the local library the element plays
 * the sandboxed file (asset protocol → blob → stream fallback chain), so a
 * downloaded track keeps playing with no network at all.
 *
 * Continuity: queue, current track, shuffle/repeat and the exact playhead
 * position are persisted into SQLite (see `persistence.ts`) and restored on
 * startup.
 */
export interface PlayerContextValue {
  audioRef: RefObject<HTMLAudioElement | null>;
  current: Track | null;
  meta: TrackMeta | null;
  queue: Track[];
  history: Track[];
  related: Track[];
  relatedFor: string | null;
  isPlaying: boolean;
  buffering: boolean;
  error: string | null;
  dismissError: () => void;
  shuffle: boolean;
  repeat: RepeatMode;
  sheetOpen: boolean;
  setSheetOpen: (open: boolean) => void;
  playTrack: (rawTrack: unknown, contextTracks?: unknown[] | null, options?: { openSheet?: boolean }) => void;
  playAll: (tracks: unknown[], index?: number) => void;
  addToQueue: (rawTrack: unknown) => void;
  playNext: (rawTrack: unknown) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  togglePlay: () => void;
  next: (auto?: boolean) => void;
  previous: () => void;
  seek: (seconds: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  waitForCache: (videoId: string) => Promise<void>;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

/**
 * Playback position — deliberately **not** part of `PlayerContext`.
 *
 * `timeupdate` fires several times a second while a song plays; if the
 * playhead lived in the main context, every consumer (home grids, queue
 * rows, the whole Now Playing sheet) would repaint on every tick, and
 * that main-thread churn is what made the motion artwork video stutter
 * *only while audio played*. Only the scrubber, the lyrics follow and
 * the mini-player bar subscribe here — small trees, so a tick costs
 * almost nothing.
 */
export interface PlayheadContextValue {
  /** Current position in seconds. */
  currentTime: number;
  /** Audio length in seconds — `0` until metadata lands. */
  duration: number;
  /** How far the element has buffered ahead of the playhead (seconds). */
  buffered: number;
}

const PlayheadContext = createContext<PlayheadContextValue | null>(null);

const HISTORY_LIMIT = 100;

/** Last second of the track the player has already downloaded. */
function bufferedEnd(audio: HTMLAudioElement): number {
  const ranges = audio.buffered;
  if (!ranges || !ranges.length) return 0;
  return ranges.end(ranges.length - 1);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function shuffled<T>(list: T[]): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const positionRef = useRef(0);
  const resumeRef = useRef<number | null>(null);
  const sourceRef = useRef<AudioSource | null>(null);

  const [current, setCurrent] = useState<Track | null>(null);
  const [meta, setMeta] = useState<TrackMeta | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [history, setHistory] = useState<Track[]>([]);
  const [related, setRelated] = useState<Track[]>([]);
  const [relatedFor, setRelatedFor] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  // What the `<audio>` element reports for the container — untrustworthy on
  // its own (a fragmented or corrupted m4a can claim a doubled length), so it
  // is only the last-resort fallback for the exposed duration below.
  const [elementDuration, setElementDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);

  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>('off'); // off | all | one
  const [sheetOpen, setSheetOpen] = useState(false);
  /** True once the startup restore finished — persistence starts then. */
  const [restored, setRestored] = useState(false);

  const { lyricsProvider } = useSettings();

  // While "Adaptive accent color" is on, the cover of the playing song sets
  // the theme's accent (see theme/adaptiveAccent).
  useAdaptiveAccent(current);

  // ── Startup restore ─────────────────────────────────────────────────────
  // Runs once: queue + current track + shuffle/repeat come back, and the
  // playhead is re-attached when the new source reports its metadata.
  useEffect(() => {
    let cancelled = false;
    loadPlayback()
      .then((snapshot) => {
        if (cancelled) return;
        if (snapshot) {
          const currentTrack =
            snapshot.queue.find((track) => track.videoId === snapshot.currentVideoId) ??
            snapshot.history.find((track) => track.videoId === snapshot.currentVideoId) ??
            null;
          setQueue(snapshot.queue.filter((track) => track.videoId !== snapshot.currentVideoId));
          setHistory(snapshot.history);
          setShuffle(snapshot.shuffle);
          setRepeat(snapshot.repeat);
          if (currentTrack) {
            // Seed both refs: the persistence layer never sees a fake "0s"
            // between the restore and the first metadata event.
            positionRef.current = snapshot.positionMs / 1000;
            resumeRef.current = positionRef.current;
            setCurrent(currentTrack);
          }
        }
      })
      .catch((error_) => console.warn('[playback] restore failed', error_))
      .finally(() => {
        if (!cancelled) setRestored(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { flush } = usePlaybackPersistence({
    ready: restored,
    current,
    queue,
    history,
    shuffle,
    repeat,
    isPlaying,
    positionRef,
  });

  // ── Tray bridge (desktop) ───────────────────────────────────────────────
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    onTrayAction((action) => {
      if (action === 'toggle') togglePlayRef.current();
      else nextRef.current();
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    emitTrayState(isPlaying);
  }, [isPlaying]);

  // ── Audio element control ────────────────────────────────────────────────

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (audio.paused) {
      const attempt = audio.play();
      if (attempt) attempt.catch(() => setError('Playback was blocked by the system'));
    } else {
      audio.pause();
    }
  }, [current]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(time)) return;
    audio.currentTime = Math.max(0, time);
    positionRef.current = audio.currentTime;
    setCurrentTime(audio.currentTime);
    syncBuffered();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * How far the player has already loaded, in seconds.
   *
   * Only the range that covers (or precedes) the playhead counts, so a stray
   * second range never makes the seek bar look ahead of itself.
   */
  function syncBuffered() {
    const audio = audioRef.current;
    if (!audio) return;
    const ranges = audio.buffered;
    let end = 0;
    for (let index = 0; index < ranges.length; index += 1) {
      if (ranges.start(index) <= audio.currentTime + 1) {
        end = Math.max(end, ranges.end(index));
      }
    }
    setBuffered((previous) => (Math.abs(previous - end) > 0.2 ? end : previous));
  }

  /**
   * A stall earns the spinner — and a repaint of every `buffering`
   * consumer — only once it *lasts*: streams flap `waiting`/`playing` in
   * bursts while a song plays, and each flip used to repaint the whole
   * app. Track starts set `buffering` directly (see the play paths), so
   * the loading spinner still appears immediately there.
   */
  const stallTimer = useRef<number | null>(null);
  const flagStall = useCallback(() => {
    if (stallTimer.current !== null) return;
    stallTimer.current = window.setTimeout(() => setBuffering(true), 250);
  }, []);
  const clearStall = useCallback(() => {
    if (stallTimer.current !== null) {
      window.clearTimeout(stallTimer.current);
      stallTimer.current = null;
    }
    setBuffering(false);
  }, []);

  // ── Queue / track selection ─────────────────────────────────────────────

  const playTrack = useCallback(
    (rawTrack: unknown, contextTracks: unknown[] | null = null, options: { openSheet?: boolean } = {}) => {
      const track = normalizeTrack(rawTrack);
      if (!track) return;

      if (current && current.videoId === track.videoId) {
        // Pressing the song that is already active toggles it instead of
        // silently restarting it from the beginning.
        if (options.openSheet) setSheetOpen(true);
        else togglePlay();
        return;
      }

      if (current) {
        setHistory((previous) => [current, ...previous].slice(0, HISTORY_LIMIT));
      }
      if (Array.isArray(contextTracks)) {
        const list = normalizeList(contextTracks);
        const index = list.findIndex((entry) => entry.videoId === track.videoId);
        setQueue(index >= 0 ? list.slice(index + 1) : []);
      }

      setError(null);
      setMeta(null);
      positionRef.current = 0;
      setCurrentTime(0);
      setElementDuration(0);
      resumeRef.current = null;
      setCurrent(track);
      if (options.openSheet) setSheetOpen(true);
    },
    [current, togglePlay],
  );

  const playAll = useCallback(
    (tracks: unknown[], index = 0) => {
      const list = normalizeList(tracks);
      if (!list.length) return;
      const start = Math.min(Math.max(index, 0), list.length - 1);
      playTrack(list[start], list);
    },
    [playTrack],
  );

  const addToQueue = useCallback((rawTrack: unknown) => {
    const track = normalizeTrack(rawTrack);
    if (!track) return;
    setQueue((previous) => [...previous, track]);
  }, []);

  const playNext = useCallback((rawTrack: unknown) => {
    const track = normalizeTrack(rawTrack);
    if (!track) return;
    setQueue((previous) => [track, ...previous]);
  }, []);

  const removeFromQueue = useCallback((index: number) => {
    setQueue((previous) => previous.filter((_, position) => position !== index));
  }, []);

  const clearQueue = useCallback(() => setQueue([]), []);

  const buildNext = useCallback(() => {
    // the song that is playing right now never comes back as "next"
    const pending = queue.filter((entry) => entry.videoId !== current?.videoId);

    if (pending.length) {
      if (shuffle) {
        const index = Math.floor(Math.random() * pending.length);
        return {
          track: pending[index],
          rest: pending.filter((_, position) => position !== index),
        };
      }
      return { track: pending[0], rest: pending.slice(1) };
    }

    if (related.length) {
      const played = new Set([
        current?.videoId,
        ...history.map((entry) => entry.videoId),
      ]);
      const fresh = related.filter((entry) => !played.has(entry.videoId));
      const pool = fresh.length ? fresh : related;
      const pick = shuffle ? pool[Math.floor(Math.random() * pool.length)] : pool[0];
      return { track: pick, rest: null };
    }

    if (repeat === 'all' && history.length) {
      const oldestFirst = [...history].reverse();
      return { track: oldestFirst[0], rest: oldestFirst.slice(1) };
    }

    return { track: null, rest: null };
  }, [queue, related, repeat, shuffle, history, current]);

  const next = useCallback(
    (auto = false) => {
      if (auto && repeat === 'one') {
        seek(0);
        const attempt = audioRef.current?.play();
        if (attempt) attempt.catch(() => {});
        return;
      }

      const { track, rest } = buildNext();
      if (!track) {
        setIsPlaying(false);
        return;
      }
      if (rest) setQueue(rest);
      playTrack(track);
    },
    [buildNext, playTrack, repeat, seek],
  );

  const previous = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      seek(0);
      return;
    }
    if (!history.length) {
      seek(0);
      return;
    }
    const [last, ...rest] = history;
    setHistory(rest);
    setError(null);
    setMeta(null);
    positionRef.current = 0;
    setCurrentTime(0);
    setElementDuration(0);
    resumeRef.current = null;
    setCurrent(last!);
  }, [history, seek]);

  const toggleShuffle = useCallback(() => {
    setShuffle((value) => {
      const enabled = !value;
      if (enabled) setQueue((currentQueue) => shuffled(currentQueue));
      return enabled;
    });
  }, []);

  const cycleRepeat = useCallback(() => {
    setRepeat((value) => (value === 'off' ? 'all' : value === 'all' ? 'one' : 'off'));
  }, []);

  // Stable handles for the tray bridge (registered once, called anytime).
  const togglePlayRef = useRef(togglePlay);
  const nextRef = useRef(next);
  useEffect(() => {
    togglePlayRef.current = togglePlay;
    nextRef.current = () => next();
  });

  // ── Source loading (offline first) ──────────────────────────────────────

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    if (!current) {
      audio.removeAttribute('src');
      audio.load();
      setIsPlaying(false);
      return undefined;
    }

    let cancelled = false;
    setBuffering(true);
    setBuffered(0);

    const load = async () => {
      // Offline first, same chain as the WebView: the asset protocol where
      // one exists, the IndexedDB blob where it doesn't (browser / iOS), the
      // live stream only when the song is not on the device at all.
      let local = localAssetSource(current.videoId);
      if (!local && !isTauri) {
        try {
          local = await localBlobSource(current.videoId);
        } catch {
          local = null;
        }
        if (cancelled) return;
      }
      const source: AudioSource = local ?? { url: streamUrl(current.videoId), kind: 'stream' };
      if (cancelled) return;
      sourceRef.current = source;
      audio.src = source.url;
      audio.load();
      const attempt = audio.play();
      if (attempt) {
        attempt.catch((playError: DOMException) => {
          if (playError?.name !== 'AbortError') setBuffering(false);
        });
      }
    };
    void load();

    return () => {
      cancelled = true;
      // Detaching on change prevents stale downloads from playing
      audio.removeAttribute('src');
    };
  }, [current?.videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Local cover for downloaded songs ─────────────────────────────────────

  // A download stores the best cover that existed at save time (usually the
  // maxresdefault JPEG). The player surfaces paint that file instead of the
  // CDN chain behind `track.artwork`, which walks down to `sddefault`
  // whenever `maxresdefault` is missing — and it costs no network at all.
  // The data URL is cached per song (`localArtworkDataUrl`), so revisits are
  // instant; a song without artwork keeps the CDN chain untouched.
  useEffect(() => {
    const videoId = current?.videoId;
    if (!videoId || !isDownloaded(videoId)) return undefined;
    let alive = true;
    void localArtworkDataUrl(videoId)
      .then((url) => {
        if (!alive || !url) return;
        setCurrent((track) =>
          track && track.videoId === videoId && track.artwork !== url
            ? { ...track, artwork: url }
            : track,
        );
      })
      .catch(() => {
        /* unreadable file — the CDN chain stays the cover */
      });
    return () => {
      alive = false;
    };
  }, [current?.videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Enriched metadata + related songs ───────────────────────────────────

  useEffect(() => {
    const videoId = current?.videoId;
    if (!videoId) {
      setMeta(null);
      return undefined;
    }
    let cancelled = false;
    const provider: LyricsProvider = lyricsProvider || 'auto';

    const mergeLocal = async (payload: TrackMeta | null): Promise<TrackMeta | null> => {
      try {
        const local = await localLyrics(videoId);
        if (local && !payload?.lyrics?.synced && !payload?.lyrics?.unsynced) {
          return { ...(payload ?? { videoId }), lyrics: local };
        }
      } catch {
        /* offline lyrics are a bonus */
      }
      return payload;
    };

    const fetchRemote = (): void => {
      fetchTrackMeta(videoId, provider)
        .then(async (payload) => {
          if (cancelled) return;
          setMeta(await mergeLocal(payload));
        })
        .catch(async () => {
          // No network (or server down): fall back to what the download kept.
          if (cancelled) return;
          try {
            const local = await localLyrics(videoId);
            if (local) setMeta({ videoId, lyrics: local });
          } catch {
            /* metadata is optional, playback continues without it */
          }
        });
    };

    // A downloaded song already carries its own cover and lyrics: the
    // payload is built straight from those and `/browsing/track` is never
    // asked over the network. Only a download *without* a lyrics file falls
    // back to the server — the one case where the network is the only place
    // the lyrics are still left.
    if (isDownloaded(videoId)) {
      void (async () => {
        let lyrics: TrackLyrics | null = null;
        try {
          lyrics = await localLyrics(videoId);
        } catch {
          /* read failure counts as "nothing stored" */
        }
        if (cancelled) return;
        if (!lyrics) {
          fetchRemote();
          return;
        }
        let thumb: string | null = null;
        try {
          thumb = await localArtworkDataUrl(videoId);
        } catch {
          /* the lyrics alone already spare the round trip */
        }
        if (cancelled) return;
        setMeta({
          videoId,
          title: current?.title,
          album: current?.albumName,
          thumbnails: thumb ? [{ url: thumb, width: 512, height: 512 }] : undefined,
          lyrics,
        });
      })();
      return () => {
        cancelled = true;
      };
    }

    fetchRemote();
    return () => {
      cancelled = true;
    };
  }, [current?.videoId, lyricsProvider]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const videoId = current?.videoId;
    if (!videoId) {
      setRelated([]);
      setRelatedFor(null);
      return undefined;
    }
    let cancelled = false;
    apiGet(`/browsing/related/${videoId}`, { limit: 25 })
      .then((payload) => {
        if (cancelled) return;
        const tracks = normalizeList(payload?.tracks).filter(
          (track) => track.videoId !== videoId,
        );
        setRelated(tracks);
        setRelatedFor(videoId);
      })
      .catch(() => {
        if (cancelled) return;
        setRelated([]);
        setRelatedFor(videoId);
      });
    return () => {
      cancelled = true;
    };
  }, [current?.videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── System media controls (macOS Now Playing, Control Center, …) ───────
  useMediaSession({
    audioRef,
    current,
    meta,
    isPlaying,
    onPrevious: previous,
    onNext: () => next(),
    onSeek: seek,
  });

  // ── Local home library: recent plays + suggested songs ─────────────────

  // Every song that starts playing becomes part of the "recently played" row.
  useEffect(() => {
    if (current) recordPlay(current);
  }, [current?.videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The first 10 related songs of the playing track feed the suggestion pool.
  useEffect(() => {
    if (!relatedFor || !related.length) return;
    addSuggestions(related.slice(0, 10));
  }, [relatedFor]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Audio element events ────────────────────────────────────────────────

  const handleEnded = useCallback(() => {
    if (repeat === 'one') {
      seek(0);
      const attempt = audioRef.current?.play();
      if (attempt) attempt.catch(() => {});
      return;
    }
    next(true);
  }, [next, repeat, seek]);

  /**
   * Source fallback chain: local file (asset) → local file (blob) → stream.
   *
   * Only when every step failed does the error become visible — a WebView
   * that refuses the asset protocol simply plays the blob instead, and a
   * deleted local file falls back to the server.
   */
  const handleError = useCallback(async () => {
    const videoId = current?.videoId;
    if (!videoId) return;
    const audio = audioRef.current;
    const source = sourceRef.current;

    if (source?.kind === 'asset') {
      try {
        const blob = await localBlobSource(videoId);
        if (blob && audio) {
          sourceRef.current = blob;
          setBuffering(true);
          audio.src = blob.url;
          audio.load();
          const attempt = audio.play();
          if (attempt) attempt.catch(() => setBuffering(false));
          return;
        }
      } catch {
        /* fall through to the stream */
      }
    }

    if (source?.kind !== 'stream') {
      try {
        const url = streamUrl(videoId);
        if (audio) {
          sourceRef.current = { url, kind: 'stream' };
          setBuffering(true);
          audio.src = url;
          audio.load();
          const attempt = audio.play();
          if (attempt) attempt.catch(() => setBuffering(false));
          return;
        }
      } catch {
        /* fall through to the error below */
      }
    }

    setBuffering(false);
    setIsPlaying(false);

    let message = 'This track could not be played';
    try {
      const response = await fetch(streamUrl(videoId), {
        method: 'GET',
        cache: 'no-store',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        message = payload?.detail || message;
      }
    } catch {
      /* keep the generic message */
    }
    setError(message);
  }, [current?.videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  const dismissError = useCallback(() => setError(null), []);

  /**
   * Wait until the server has finished caching *videoId* (see the download
   * pipeline): a download of the song that is streaming right now picks the
   * finished file up instead of opening a second live stream.
   *
   * It always resolves — the file landed, the buffer filled, playback moved
   * on, the player errored, twelve seconds passed without progress, or the
   * minute expired.
   */
  const waitForCache = useCallback(async (videoId: string) => {
    const token = encodeURIComponent(videoId);
    const deadline = Date.now() + 60_000;
    const STALL_LIMIT = 12_000;
    let unreachable = 0;
    let lastEnd = -1;
    let lastChangeAt = Date.now();
    let sawWholeBuffer = false;

    while (Date.now() < deadline) {
      let cached = false;
      try {
        const payload = await apiGet('/stream/status', { vidId: videoId });
        cached = Boolean(payload?.cached);
        unreachable = 0;
      } catch {
        unreachable += 1;
        if (unreachable >= 3) return;
      }
      if (cached) return;
      if (sawWholeBuffer) return;

      const audio = audioRef.current;
      if (!audio || !audio.src || !audio.src.includes(`vidId=${token}`)) return;
      if (audio.error || audio.ended) return;

      const end = bufferedEnd(audio);
      const whole =
        Number.isFinite(audio.duration) && audio.duration > 0 && end >= audio.duration - 0.5;

      if (whole) {
        sawWholeBuffer = true;
      } else if (end > lastEnd + 0.2) {
        lastEnd = end;
        lastChangeAt = Date.now();
      }

      if (Date.now() - lastChangeAt > STALL_LIMIT) return;

      await wait(750);
    }
  }, []);

  const value = useMemo<PlayerContextValue>(
    () => ({
      audioRef,
      current,
      meta,
      queue,
      history,
      related,
      relatedFor,
      isPlaying,
      buffering,
      error,
      dismissError,
      shuffle,
      repeat,
      sheetOpen,
      setSheetOpen,
      playTrack,
      playAll,
      addToQueue,
      playNext,
      removeFromQueue,
      clearQueue,
      togglePlay,
      next,
      previous,
      seek,
      toggleShuffle,
      cycleRepeat,
      waitForCache,
    }),
    [
      current,
      meta,
      queue,
      history,
      related,
      relatedFor,
      isPlaying,
      buffering,
      error,
      dismissError,
      shuffle,
      repeat,
      sheetOpen,
      playTrack,
      playAll,
      addToQueue,
      playNext,
      removeFromQueue,
      clearQueue,
      togglePlay,
      next,
      previous,
      seek,
      toggleShuffle,
      cycleRepeat,
      waitForCache,
    ],
  );

  /**
   * The song's *real* length, sourced from metadata — never from the bytes on
   * the wire. `/browsing/track`'s `duration_seconds` is authoritative: the m4a
   * served by `/stream` may carry no duration tag at all, or a corrupted /
   * doubled container that claims far more than the true length. The audio
   * element's own duration is the last-resort fallback only.
   */
  const duration =
    current?.durationSeconds || meta?.duration_seconds || elementDuration || 0;

  /** The per-tick position value, kept apart from the stable one above. */
  const playhead = useMemo<PlayheadContextValue>(
    () => ({ currentTime, duration, buffered }),
    [currentTime, duration, buffered],
  );

  return (
    <PlayerContext.Provider value={value}>
      <PlayheadContext.Provider value={playhead}>
        {children}
      </PlayheadContext.Provider>
      {/* No volume control: the element plays at full level and the OS mixer
          owns loudness, so the player keeps no volume state at all. */}
      <audio
        ref={audioRef}
        preload="auto"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onPlaying={clearStall}
        onWaiting={flagStall}
        onCanPlay={clearStall}
        onProgress={syncBuffered}
        onTimeUpdate={(event) => {
          positionRef.current = event.currentTarget.currentTime;
          setCurrentTime(event.currentTarget.currentTime);
          syncBuffered();
        }}
        onLoadedMetadata={(event) => {
          const element = event.currentTarget;
          setElementDuration(element.duration || 0);
          // Restore the saved playhead exactly once per restored session.
          if (resumeRef.current !== null && Number.isFinite(element.duration)) {
            const target = Math.min(
              Math.max(0, resumeRef.current),
              Math.max(0, element.duration - 0.5),
            );
            element.currentTime = target;
            positionRef.current = target;
            setCurrentTime(target);
            resumeRef.current = null;
          }
          syncBuffered();
        }}
        onDurationChange={(event) =>
          setElementDuration(event.currentTarget.duration || 0)
        }
        onEnded={handleEnded}
        onError={() => void handleError()}
      />
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const context = useContext(PlayerContext);
  if (!context) throw new Error('usePlayer must be used inside PlayerProvider');
  return context;
}

/**
 * Live playback position (see `PlayheadContextValue`). Subscribe here —
 * not through `usePlayer` — when a component only needs the moving
 * playhead, so per-tick updates repaint just that component.
 */
export function usePlayhead(): PlayheadContextValue {
  const context = useContext(PlayheadContext);
  if (!context) throw new Error('usePlayhead must be used inside PlayerProvider');
  return context;
}
