/**
 * Lock-screen lyrics — mirrors the **currently sung line** into the OS media
 * widget by repainting `MediaMetadata.artist` as `💬 <line>`, so the lock
 * screen / Control Center / car display of every platform shows what is
 * playing right now while `metadata.title` keeps the real track name.
 *
 * The contract that keeps this free:
 *
 *   - the mirror never touches React state — a line change calls the owner's
 *     callback, which rebuilds `MediaMetadata` directly, so the whole app
 *     does not re-render every few seconds;
 *   - the `timeupdate` listener only *computes* per tick (an `O(log n)`
 *     binary search) and only *notifies* when the active line **index**
 *     changes — never per raw timeupdate;
 *   - empty / instrumental lines keep the last sung line on the widget
 *     instead of flickering back to the plain artist name.
 *
 * The data source is the same synced lyrics the panel renders
 * (`meta.lyrics.synced` from PlayerContext) — the mirror works whether or
 * not the sheet is open.
 */
import { useEffect, useRef } from 'react';

import type { LyricLine } from '../../types/models';
import { activeLineIndexAt } from '../../utils/lyrics';

/** How the line is prefixed on the widget's artist slot. */
export const LYRIC_LINE_PREFIX = '💬';

export interface LockScreenLyricTracker {
  /** `<audio>` whose playhead defines the active line. */
  audioRef: React.RefObject<HTMLAudioElement | null>;
  /** Synced lines of the playing track — `null` when there are none. */
  lines: LyricLine[] | null;
  /** The `lockScreenLyrics` setting — off stops the mirror entirely. */
  enabled: boolean;
  /**
   * Fired with the new line **only when the active index changes**, and
   * with `null` when tracking resets (song change / disabled). Keeps the
   * latest callback in a ref so the effect never needs to re-subscribe.
   */
  onLine: (line: string | null) => void;
}

export function useLockScreenLyricTracker({
  audioRef,
  lines,
  enabled,
  onLine,
}: LockScreenLyricTracker): void {
  const notify = useRef(onLine);
  notify.current = onLine;

  useEffect(() => {
    if (!enabled || !lines?.length) return undefined;
    const audio = audioRef.current;
    if (!audio) return undefined;

    let lastIndex = -1;

    const update = () => {
      const index = activeLineIndexAt(lines, audio.currentTime * 1000);
      if (index === lastIndex) return; // ← the whole point: index changes only
      lastIndex = index;
      const text = lines[index]?.text?.trim();
      if (text) notify.current(text);
      // An empty/instrumental slot keeps the last sung line on the widget.
    };

    audio.addEventListener('timeupdate', update);
    update(); // a widget opening mid-song starts at the line already playing

    return () => {
      audio.removeEventListener('timeupdate', update);
    };
  }, [enabled, lines, audioRef]);
}
