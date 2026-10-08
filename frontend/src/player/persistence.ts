/**
 * Playback continuity — keeps SQLite's `playback_state` in sync with the
 * player so a close-to-tray hide, an OS kill or a full relaunch can always
 * resume queue, track and exact seek position.
 *
 * Cadence:
 * * structural state (queue / history / current / shuffle / repeat) —
 *   debounced 2 s after the last change;
 * * position — every 5 s while playing, immediately on pause and on
 *   `visibilitychange` / `pagehide`.
 */
import { useEffect, useRef } from 'react';

import { savePlayback } from '../db/repos/playback';
import type { PlaybackSnapshot, RepeatMode, Track } from '../types/models';

const STRUCTURAL_DEBOUNCE_MS = 2_000;
const POSITION_INTERVAL_MS = 5_000;

interface PersistenceInput {
  /** False until the startup restore finished — never overwrite a snapshot
   * with the empty initial state. */
  ready: boolean;
  current: Track | null;
  queue: Track[];
  history: Track[];
  shuffle: boolean;
  repeat: RepeatMode;
  isPlaying: boolean;
  positionRef: React.MutableRefObject<number>;
}

export interface Persistence {
  /** Writes the current snapshot immediately (used on shutdown paths). */
  flush: () => Promise<void>;
}

export function usePlaybackPersistence({
  ready,
  current,
  queue,
  history,
  shuffle,
  repeat,
  isPlaying,
  positionRef,
}: PersistenceInput): Persistence {
  const latest = useRef({ current, queue, history, shuffle, repeat, ready });
  useEffect(() => {
    latest.current = { current, queue, history, shuffle, repeat, ready };
  });

  const write = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    write.current = async () => {
      const state = latest.current;
      if (!state.ready) return;
      const snapshot: PlaybackSnapshot = {
        queue: state.queue,
        history: state.history,
        currentVideoId: state.current?.videoId ?? null,
        positionMs: Math.round(positionRef.current * 1000),
        shuffle: state.shuffle,
        repeat: state.repeat,
        updatedAt: Date.now(),
      };
      try {
        await savePlayback(snapshot);
      } catch (error) {
        console.warn('[playback] persist failed', error);
      }
    };
  }, [positionRef]);

  const flush = () => write.current();

  // Structural changes — debounced so dragging through a queue writes once.
  useEffect(() => {
    if (!ready) return undefined;
    const timer = setTimeout(() => {
      void write.current();
    }, STRUCTURAL_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [ready, current?.videoId, queue, history, shuffle, repeat]); // eslint-disable-line react-hooks/exhaustive-deps

  // Position clock while playing.
  useEffect(() => {
    if (!ready || !isPlaying) return undefined;
    const timer = setInterval(() => {
      void write.current();
    }, POSITION_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [ready, isPlaying]);

  // The playhead at the moment playback stops is the one worth remembering.
  useEffect(() => {
    if (!ready || isPlaying) return;
    void write.current();
  }, [ready, isPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

  // App backgrounded or page going away.
  useEffect(() => {
    if (!ready) return undefined;
    const onHide = () => {
      void write.current();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, [ready]);

  return { flush };
}
