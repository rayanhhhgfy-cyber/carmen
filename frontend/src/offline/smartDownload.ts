/**
 * Smart downloads — the "listened to half of it, so keep it" rule.
 *
 * With the setting on (Settings → Downloads), a song whose playhead has
 * crossed the halfway mark is saved into the sandbox exactly like a manual
 * Download would be, so the rest of the session — and every later replay —
 * keeps working with no network at all. Deliberate constraints:
 *
 *   * opt-in only — the toggle defaults to off, since every automatic save
 *     costs device storage the user did not ask for;
 *   * once per videoId per app session — a save that failed is not hammered
 *     on every `timeupdate`, and scrubbing back and forth across the
 *     midpoint cannot queue a second job (`startDownload` additionally
 *     refuses while a job for the id is running or done);
 *   * songs already on the device are skipped outright.
 *
 * The save waits for the server's stream cache (`waitForCache`) the same way
 * the in-player Download button does: the song is mid-play, so its audio is
 * already in flight — kicking off a second fetch right away would race the
 * buffer for nothing.
 */
import { useEffect, useRef } from 'react';

import { usePlayer, usePlayhead } from '../player/PlayerContext';
import { useSettings } from '../settings/store';
import { startDownload } from '../utils/downloads';
import { isDownloaded } from './source';

/** Watches the playhead of the active track and triggers the half-listened save. */
function useSmartDownload(): void {
  const { smartDownload } = useSettings();
  const { currentTime, duration } = usePlayhead();
  const player = usePlayer();
  // videoIds already offered to the downloader during this session.
  const fired = useRef<Set<string>>(new Set());

  const track = player.current;
  const videoId = track?.videoId ?? null;
  // `meta` is wiped on every track change and re-fetched for the new id, so
  // it is only handed over when it demonstrably belongs to this track.
  const meta = player.meta?.videoId === videoId ? player.meta : null;

  useEffect(() => {
    if (!smartDownload || !track || !videoId) return;
    if (!Number.isFinite(duration) || duration <= 0) return;
    if (currentTime < duration / 2) return;
    if (fired.current.has(videoId)) return;
    fired.current.add(videoId);
    if (isDownloaded(videoId)) return;
    startDownload(track, meta, { waitForCache: () => player.waitForCache(videoId) });
  }, [smartDownload, currentTime, duration, track, videoId, meta, player]);
}

/**
 * Zero-render mount for the rule above.
 *
 * It subscribes to `usePlayhead()`, which re-renders several times a second
 * while audio plays — fine for a leaf that paints nothing, but Layout (or
 * any other wide component) must never subscribe to the playhead directly:
 * see the `PlayheadContextValue` note in `player/PlayerContext.tsx`.
 */
export default function SmartDownloadWatcher(): null {
  useSmartDownload();
  return null;
}
