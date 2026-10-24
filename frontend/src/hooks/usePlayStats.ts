/**
 * Play-stats listener — the thin glue between the player and `utils/stats`.
 *
 * Reads PlayerContext state ONLY (no PlayerContext changes): the current
 * track from `usePlayer()` and the moving playhead from `usePlayhead()`.
 * One `PlaySession` lives in a ref per track-start: a new track id starts a
 * new session, while seeks, rewinds and repeat-one replays keep the same
 * session object — so the counting rule in `utils/stats.ts` (30 seconds or
 * completion, once per session) is enforced by construction, and the
 * store's session-key dedupe covers the rest.
 *
 * MOUNTING (coordinator step — this file alone counts nothing):
 *   This hook must live in an always-mounted leaf inside PlayerProvider,
 *   beside `SmartDownloadWatcher` in `Layout.tsx` (see the exact snippet in
 *   the delivery report). Mounting it in StatsPage would only count plays
 *   made while that page is open. It paints nothing, and it subscribes to
 *   the playhead the same way SmartDownloadWatcher does, so the shell
 *   never re-renders on playback ticks.
 */
import { useEffect, useRef } from 'react';

import { usePlayer, usePlayhead } from '../player/PlayerContext';
import {
  advancePlaySession,
  recordCountedPlay,
  sessionToRecord,
  startPlaySession,
  updateCountedPlaySeconds,
  type PlaySession,
} from '../utils/stats';

export function usePlayStats(): void {
  const player = usePlayer();
  const { currentTime, duration } = usePlayhead();
  const sessionRef = useRef<PlaySession | null>(null);

  const track = player.current;
  const videoId = track?.videoId ?? null;

  // A new track id starts a new session; the same id keeps its session
  // (repeat-one rewinds and manual restarts never mint a new one). The
  // guard also makes StrictMode's double effect-invocation a no-op.
  useEffect(() => {
    if (!videoId || !track) {
      sessionRef.current = null;
      return;
    }
    if (sessionRef.current?.videoId !== videoId) {
      sessionRef.current = startPlaySession(track, Date.now());
    }
  }, [videoId, track]);

  // Playhead ticks: count at 30s / completion, then keep the counted
  // play's listened seconds growing with the furthest playhead reached.
  // Paused ticks are ignored — scrubbing to 0:40 while paused is not a
  // play; the first tick after pressing play counts it.
  useEffect(() => {
    const session = sessionRef.current;
    if (!player.isPlaying || !session || session.videoId !== videoId || !track) return;
    const { session: next, newlyCounted } = advancePlaySession(session, {
      position: currentTime,
      duration,
    });
    sessionRef.current = next;
    if (newlyCounted) {
      recordCountedPlay(sessionToRecord(track, next));
    } else if (next.counted) {
      updateCountedPlaySeconds(next.sessionKey, next.maxPosition);
    }
  }, [player.isPlaying, currentTime, duration, videoId, track]);

  // The element's own `ended` event covers completion even if the
  // playhead watchdog already advanced the queue: the session guard
  // makes the double fire a no-op.
  useEffect(() => {
    const audio = player.audioRef.current;
    if (!audio || !videoId) return undefined;
    const onEnded = () => {
      const session = sessionRef.current;
      if (!session || session.videoId !== videoId || !track) return;
      const { session: next, newlyCounted } = advancePlaySession(session, {
        position: session.maxPosition,
        duration: 0,
        ended: true,
      });
      sessionRef.current = next;
      if (newlyCounted) recordCountedPlay(sessionToRecord(track, next));
    };
    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
  }, [videoId, track, player.audioRef]);
}

/** Zero-render mount for the listener above (see the header note). */
export default function PlayStatsWatcher(): null {
  usePlayStats();
  return null;
}
