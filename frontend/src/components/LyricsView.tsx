import { useEffect, useMemo, useRef, useState } from 'react';

import { usePlayer } from '../player/PlayerContext';
import type { LyricLine } from '../types/models';
import { Shimmer } from './ui';
import SyncedLyrics from './SyncedLyrics';

interface LyricsViewProps {
  /** Timestamped lines of the playing song, or `null` when there are none. */
  synced?: LyricLine[] | null;
  /** Plain text fallback for songs without timestamps. */
  unsynced?: string | null;
  /** Attribution of the lyrics provider, shown under the text. */
  source?: string | null;
  /** True while the track metadata — and with it the lyrics — is loading. */
  loading?: boolean;
}

/** Metadata that has not arrived by then counts as "no lyrics". */
const LOAD_TIMEOUT_MS = 6000;

/**
 * MIGRATION: the fade keyframes used to live in the plain-text page's
 * `Typography` sx; `styles.css` is off limits, so the block ships inline.
 */
const LYRICS_FADE_KEYFRAMES = `@keyframes lyrics-fade {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}`;

/**
 * Lyrics panel — a synced karaoke view with a plain-text fallback.
 *
 * **Following the song.**  The synced view is handed to `SyncedLyrics`, the
 * in-house engine: a playhead probe feeds a binary search, React state only
 * changes when the *line* changes, a self-stopping rAF loop eases the
 * scroller to the centred line, and the rows themselves are windowed by
 * `@tanstack/react-virtual` and `React.memo`'d — so a tick costs an
 * `O(log n)` search and nothing else, and only the lines whose highlight
 * actually changed repaint.  A wheel, finger or scrollbar drag from the
 * reader suspends the follow for 2.5s (`SyncedLyrics`), and a tapped line
 * resumes it immediately while it seeks the song there.
 *
 * **Highlight.** The active line wears the accent colour plus a slight
 * scale and weight — a transform, so nothing in the list reflows while the
 * song plays — while past lines dim and upcoming lines stay readable.
 *
 * Typography follows the theme, which is built from the interface font
 * setting (see `settings/store` + `buildTheme`), and lines use a comfortable
 * unitless line height so the rows keep a steady rhythm no matter which font
 * is selected.
 *
 * Falls back to a scrollable plain text page (always pinned to the top)
 * when no timestamps exist, and to a quiet empty state otherwise.
 */
export default function LyricsView({ synced, unsynced, source, loading = false }: LyricsViewProps) {
  const { seek, current } = usePlayer();

  /** Only the plain-text fallback scrolls by hand — the engine owns its box. */
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [timedOut, setTimedOut] = useState(false);

  /** Defensive copy of the payload lines (bad timestamps become `0`), in
   *  timestamp order — the engine's binary search depends on it. */
  const lines = useMemo<LyricLine[]>(() => {
    if (!Array.isArray(synced)) return [];
    return (
      synced.map((line) => ({
        timeMs: Number(line?.timeMs) || 0,
        // an embedded newline would split a row's layout, so flatten breaks first
        text: String(line?.text ?? '')
          .replace(/[\r\n]+/g, ' ')
          .trim(),
      }))
        // stable sort: sorted payloads (the normal case) keep their order
        .sort((a, b) => a.timeMs - b.timeMs)
    );
  }, [synced]);

  const hasSynced = lines.length > 0;
  const stillLoading = loading && !timedOut;

  // Metadata that never arrives (offline, provider down) must not spin
  // forever — after the deadline the panel reports the song as lyricless.
  useEffect(() => {
    if (!loading) {
      setTimedOut(false);
      return undefined;
    }
    const timer = setTimeout(() => setTimedOut(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [loading]);

  // A plain-text page always opens at the first verse.
  useEffect(() => {
    if (hasSynced) return;
    scrollRef.current?.scrollTo({ top: 0 });
  }, [unsynced, hasSynced]);

  // ── Loading ────────────────────────────────────────────────────────────
  if (stillLoading && !hasSynced) {
    return (
      <div
        aria-busy
        aria-live="polite"
        className="flex h-full flex-col items-center gap-3 px-6 py-3"
      >
        {[70, 92, 58, 84, 66, 78].map((width, index) => (
          <Shimmer
            key={width}
            variant="rounded"
            width={`${width}%`}
            height={24}
            style={{ opacity: 1 - index * 0.12 }}
          />
        ))}
        <span className="text-xs leading-[1.4] text-disabled">
          Finding lyrics…
        </span>
      </div>
    );
  }

  // ── Nothing to sing along to ───────────────────────────────────────────
  if (!hasSynced && !unsynced) {
    return (
      <div aria-live="polite" className="grid h-full place-items-center px-6 py-12">
        <div className="text-center">
          <p className="m-0 text-base font-semibold text-muted">
            Lyrics not available yet
          </p>
          <span className="text-xs leading-[1.4] text-disabled">
            {current?.title}
          </span>
        </div>
      </div>
    );
  }

  // ── Unsynced fallback: plain page, pinned to the top ───────────────────
  if (!hasSynced) {
    return (
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto px-6 py-4"
        style={{
          maskImage:
            'linear-gradient(to bottom, transparent, black 6%, black 92%, transparent)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent, black 6%, black 92%, transparent)',
        }}
      >
        <style>{LYRICS_FADE_KEYFRAMES}</style>
        <p
          className="m-0 whitespace-pre-line text-center text-base leading-[1.5] text-muted"
          style={{
            lineHeight: 2,
            fontSize: '1.05rem',
            animation: 'lyrics-fade 500ms ease',
          }}
        >
          {unsynced}
        </p>
        {source && (
          <span className="mt-4 block text-center text-xs leading-[1.4] text-disabled">
            {source}
          </span>
        )}
      </div>
    );
  }

  // ── Synced karaoke view ────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SyncedLyrics lines={lines} onSeek={seek} />
      {source && (
        <span className="block shrink-0 px-4 pb-2 text-center text-xs leading-[1.4] text-disabled">
          {source}
        </span>
      )}
    </div>
  );
}
