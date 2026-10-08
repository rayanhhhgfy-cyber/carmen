import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Skeleton, Typography } from '@mui/material';

import { usePlayer } from '../player/PlayerContext';
import type { LyricLine } from '../types/models';
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
      <Box
        aria-busy
        aria-live="polite"
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 1.5,
          py: 3,
          px: 3,
          height: '100%',
        }}
      >
        {[70, 92, 58, 84, 66, 78].map((width, index) => (
          <Skeleton
            key={width}
            variant="rounded"
            width={`${width}%`}
            height={24}
            sx={{ opacity: 1 - index * 0.12 }}
          />
        ))}
        <Typography variant="caption" color="text.disabled">
          Finding lyrics…
        </Typography>
      </Box>
    );
  }

  // ── Nothing to sing along to ───────────────────────────────────────────
  if (!hasSynced && !unsynced) {
    return (
      <Box
        aria-live="polite"
        sx={{ display: 'grid', placeItems: 'center', py: 6, px: 3, height: '100%' }}
      >
        <Box sx={{ textAlign: 'center' }}>
          <Typography variant="subtitle1" color="text.secondary">
            Lyrics not available yet
          </Typography>
          <Typography variant="caption" color="text.disabled">
            {current?.title}
          </Typography>
        </Box>
      </Box>
    );
  }

  // ── Unsynced fallback: plain page, pinned to the top ───────────────────
  if (!hasSynced) {
    return (
      <Box
        ref={scrollRef}
        sx={{
          overflowY: 'auto',
          height: '100%',
          px: 3,
          py: 2,
          maskImage:
            'linear-gradient(to bottom, transparent, black 6%, black 92%, transparent)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent, black 6%, black 92%, transparent)',
        }}
      >
        <Typography
          sx={{
            whiteSpace: 'pre-line',
            textAlign: 'center',
            lineHeight: 2,
            fontSize: '1.05rem',
            animation: 'lyrics-fade 500ms ease',
            '@keyframes lyrics-fade': {
              from: { opacity: 0, transform: 'translateY(8px)' },
              to: { opacity: 1, transform: 'translateY(0)' },
            },
          }}
          color="text.secondary"
        >
          {unsynced}
        </Typography>
        {source && (
          <Typography
            variant="caption"
            color="text.disabled"
            sx={{ display: 'block', mt: 2, textAlign: 'center' }}
          >
            {source}
          </Typography>
        )}
      </Box>
    );
  }

  // ── Synced karaoke view ────────────────────────────────────────────────
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <SyncedLyrics lines={lines} onSeek={seek} />
      {source && (
        <Typography
          variant="caption"
          color="text.disabled"
          sx={{ display: 'block', textAlign: 'center', flexShrink: 0, px: 2, pb: 1 }}
        >
          {source}
        </Typography>
      )}
    </Box>
  );
}
