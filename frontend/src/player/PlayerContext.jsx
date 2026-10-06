import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { apiGet, streamUrl } from '../api';
import { useMediaSession } from './mediaSession';
import { addSuggestions, recordPlay } from '../utils/library';
import { normalizeList, normalizeTrack } from '../utils/track';

/**
 * Playback engine: one <audio> element, a queue, shuffle/repeat, the
 * contextually related list and the enriched metadata of the active track.
 *
 * When the queue runs out the engine automatically keeps playing from the
 * related songs of the current track.
 */
const PlayerContext = createContext(null);

const HISTORY_LIMIT = 100;

/** Last second of the track the player has already downloaded. */
function bufferedEnd(audio) {
  const ranges = audio.buffered;
  if (!ranges || !ranges.length) return 0;
  return ranges.end(ranges.length - 1);
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function shuffled(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function PlayerProvider({ children }) {
  const audioRef = useRef(null);

  const [current, setCurrent] = useState(null);
  const [meta, setMeta] = useState(null);
  const [queue, setQueue] = useState([]);
  const [history, setHistory] = useState([]);
  const [related, setRelated] = useState([]);
  const [relatedFor, setRelatedFor] = useState(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);

  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off'); // off | all | one
  const [sheetOpen, setSheetOpen] = useState(false);

  // ── Audio element control ────────────────────────────────────────────────

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (audio.paused) {
      const attempt = audio.play();
      if (attempt) attempt.catch(() => setError('Playback was blocked by the browser'));
    } else {
      audio.pause();
    }
  }, [current]);

  const seek = useCallback((time) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(time)) return;
    audio.currentTime = Math.max(0, time);
    setCurrentTime(audio.currentTime);
    syncBuffered();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * How far the browser has already downloaded, in seconds.
   *
   * Only the range that covers (or precedes) the playhead counts, so a
   * stray second range never makes the seek bar look ahead of itself.
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

  // ── Queue / track selection ─────────────────────────────────────────────

  const playTrack = useCallback(
    (rawTrack, contextTracks = null, options = {}) => {
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
      setCurrentTime(0);
      setDuration(0);
      setCurrent(track);
      if (options.openSheet) setSheetOpen(true);
    },
    [current, isPlaying, togglePlay],
  );

  const playAll = useCallback(
    (tracks, index = 0) => {
      const list = normalizeList(tracks);
      if (!list.length) return;
      const start = Math.min(Math.max(index, 0), list.length - 1);
      playTrack(list[start], list);
    },
    [playTrack],
  );

  const addToQueue = useCallback((rawTrack) => {
    const track = normalizeTrack(rawTrack);
    if (!track) return;
    setQueue((previous) => [...previous, track]);
  }, []);

  const playNext = useCallback((rawTrack) => {
    const track = normalizeTrack(rawTrack);
    if (!track) return;
    setQueue((previous) => [track, ...previous]);
  }, []);

  const removeFromQueue = useCallback((index) => {
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
    setCurrentTime(0);
    setDuration(0);
    setCurrent(last);
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

  // ── Source loading ──────────────────────────────────────────────────────

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    if (!current) {
      audio.removeAttribute('src');
      audio.load();
      setIsPlaying(false);
      return undefined;
    }

    setBuffering(true);
    setBuffered(0);
    audio.src = streamUrl(current.videoId);
    audio.load();
    const attempt = audio.play();
    if (attempt) {
      attempt.catch((playError) => {
        if (playError.name !== 'AbortError') {
          setBuffering(false);
        }
      });
    }

    return () => {
      // Detaching on change prevents stale downloads from playing
      audio.removeAttribute('src');
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
    apiGet(`/browsing/track/${videoId}`)
      .then((payload) => {
        if (!cancelled) setMeta(payload);
      })
      .catch(() => {
        /* metadata is optional, playback continues without it */
      });
    return () => {
      cancelled = true;
    };
  }, [current?.videoId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = volume;
  }, [volume]);

  // ── System media controls (macOS Now Playing, Control Center, …) ───────
  // Registers its handlers once and reads these callbacks through a ref, so
  // nothing here re-binds or goes stale on every render.
  useMediaSession({
    audioRef,
    current,
    meta,
    isPlaying,
    onPrevious: previous,
    onNext: next,
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

  const handleError = useCallback(async () => {
    const videoId = current?.videoId;
    if (!videoId) return;
    setBuffering(false);
    setIsPlaying(false);

    let message = 'This track could not be played';
    try {
      const response = await fetch(streamUrl(videoId), { method: 'GET' });
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
   * Wait until the server has finished caching *videoId*.
   *
   * The relay tees every byte it sends the player into the server's audio
   * cache, so a download of the song that is playing right now waits here
   * and then picks the finished file up from disk — instead of opening a
   * second live stream next to the one this player is holding open.
   *
   * It always resolves: the file landed, the whole track arrived, playback
   * moved to another song, the player errored or ended, nothing moved for
   * twelve seconds, the server stopped answering, or the minute passed.
   */
  const waitForCache = useCallback(async (videoId) => {
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
        // a server that does not answer (or still runs the old build
        // without /stream/status) must not stall the download for a minute
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
        // the last byte just reached the browser — give the relay a beat to
        // close the file, then the status check above confirms it
        sawWholeBuffer = true;
      } else if (end > lastEnd + 0.2) {
        lastEnd = end;
        lastChangeAt = Date.now();
      }

      // the player stopped pulling data: waiting any longer would only
      // delay a download the stream is no longer helping with
      if (Date.now() - lastChangeAt > STALL_LIMIT) return;

      await wait(750);
    }
  }, []);

  const value = useMemo(
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
      currentTime,
      duration,
      buffered,
      volume,
      shuffle,
      repeat,
      sheetOpen,
      setSheetOpen,
      setVolume,
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
      currentTime,
      duration,
      buffered,
      volume,
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

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        preload="auto"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onPlaying={() => setBuffering(false)}
        onWaiting={() => setBuffering(true)}
        onCanPlay={() => setBuffering(false)}
        onProgress={syncBuffered}
        onTimeUpdate={(event) => {
          setCurrentTime(event.currentTarget.currentTime);
          syncBuffered();
        }}
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration || 0);
          syncBuffered();
        }}
        onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
        onEnded={handleEnded}
        onError={handleError}
      />
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const context = useContext(PlayerContext);
  if (!context) throw new Error('usePlayer must be used inside PlayerProvider');
  return context;
}
