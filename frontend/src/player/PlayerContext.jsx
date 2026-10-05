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
  }, []);

  // ── Queue / track selection ─────────────────────────────────────────────

  const playTrack = useCallback(
    (rawTrack, contextTracks = null, options = {}) => {
      const track = normalizeTrack(rawTrack);
      if (!track) return;

      if (current && current.videoId === track.videoId) {
        if (!isPlaying) togglePlay();
        if (options.openSheet) setSheetOpen(true);
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
    if (queue.length) {
      if (shuffle) {
        const index = Math.floor(Math.random() * queue.length);
        return {
          track: queue[index],
          rest: queue.filter((_, position) => position !== index),
        };
      }
      return { track: queue[0], rest: queue.slice(1) };
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
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
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
