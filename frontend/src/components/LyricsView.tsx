import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Skeleton, Typography } from '@mui/material';
import { Lrc, useRecoverAutoScrollImmediately, type LrcLine } from 'react-lrc';

import { usePlayhead, usePlayer } from '../player/PlayerContext';
import { useTheme } from '../theme/ThemeContext';
import type { LyricLine } from '../types/models';
import { toLrc } from '../utils/lyrics';

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

/** How long the reader's own scrolling pauses the follow (ms). */
const RESUME_FOLLOW_MS = 2500;

/** Metadata that has not arrived by then counts as "no lyrics". */
const LOAD_TIMEOUT_MS = 6000;

/**
 * Lyrics panel — a synced karaoke view with a plain-text fallback.
 *
 * **Following the song.** The synced view hands the whole job to `react-lrc`
 * (`Lrc`): the payload lines are serialised to LRC text with the shared
 * `toLrc()` helper, the playhead is fed in as `currentMillisecond`, and the
 * library re-centres the active line itself — a native smooth scroll that
 * only fires when the line index changes, never on every `timeupdate`.
 * That hand-off is what keeps the panel responsive; the previous
 * hand-rolled version measured offsets and restarted CSS animations on its
 * own and could not keep up. A wheel, finger or scrollbar drag from the
 * reader suspends the follow for `RESUME_FOLLOW_MS`, and a tapped line
 * resumes it immediately (`recoverAutoScrollImmediately`) while it seeks the
 * song there (`line.startMillisecond / 1000`).
 *
 * **Highlight.** The active line wears the accent colour plus a slight
 * scale and weight — a transform, so nothing in the list reflows while the
 * song plays — while past lines dim and upcoming lines stay readable. The
 * active flag comes straight from `Lrc`'s `lineRenderer`; the "already
 * sung" dimming follows the index reported through `onLineUpdate`, which
 * only fires when the line changes, so it costs nothing per tick.
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
  const { currentTime } = usePlayhead();
  // Accent for the active line — `accentFg` stays legible even when the
  // white high-performance accent would vanish on a light surface.
  const { accentFg } = useTheme();

  /** Only the plain-text fallback scrolls by hand — `Lrc` owns its own box. */
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [timedOut, setTimedOut] = useState(false);
  /** Index `Lrc` last reported as active — drives the "past lines" dimming. */
  const [activeIndex, setActiveIndex] = useState(-1);

  /** Flipping `signal` tells `Lrc` to start following again right now. */
  const { signal, recoverAutoScrollImmediately } = useRecoverAutoScrollImmediately();

  /** Defensive copy of the payload lines (bad timestamps become `0`). */
  const lines = useMemo<LyricLine[]>(() => {
    if (!Array.isArray(synced)) return [];
    return synced.map((line) => ({
      timeMs: Number(line?.timeMs) || 0,
      // an embedded newline would split the LRC line we serialise below and
      // silently drop the rest of the text, so flatten line breaks first
      text: String(line?.text ?? '')
        .replace(/[\r\n]+/g, ' ')
        .trim(),
    }));
  }, [synced]);

  /** The same lines in the `[mm:ss.xx]text` dialect `Lrc` parses. */
  const lrc = useMemo(() => toLrc(lines), [lines]);

  const hasSynced = lines.length > 0;
  const stillLoading = loading && !timedOut;
  /** React-side form of the playhead, handed straight to `Lrc`. */
  const currentMillisecond = Math.max(0, currentTime) * 1000;

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

  /** Called only when `Lrc` moves to a different line — cheap by design. */
  const handleLineUpdate = useCallback(({ index }: { index: number; line: LrcLine | null }) => {
    setActiveIndex(index);
  }, []);

  const handleLineClick = useCallback(
    (line: LrcLine) => {
      // the tap *is* the decision — resume following this line immediately
      recoverAutoScrollImmediately();
      seek(line.startMillisecond / 1000);
    },
    [recoverAutoScrollImmediately, seek],
  );

  // Memoised so `Lrc` can skip re-rendering its lines between ticks; only a
  // change of the active line gives it a fresh renderer.
  const lineRenderer = useCallback(
    ({ index, active, line }: { index: number; active: boolean; line: LrcLine }) => {
      // `onLineUpdate` reports a line only after this render, so the stored
      // index lags by one frame — `<=` keeps the line we just sang marked as
      // past instead of letting it flicker back to "upcoming".
      const past = !active && index <= activeIndex;
      return (
        <Typography
          component="button"
          type="button"
          aria-current={active || undefined}
          onClick={() => handleLineClick(line)}
          sx={{
            border: 'none',
            background: 'none',
            p: 1.25,
            m: 0,
            display: 'block',
            width: '100%',
            borderRadius: 2,
            textAlign: 'center',
            cursor: 'pointer',
            fontFamily: 'inherit',
            // unitless line height: every row keeps the same height even
            // as the active line changes weight — nothing reflows mid-song
            lineHeight: 1.8,
            fontSize: { xs: '1.1rem', md: '1.15rem' },
            fontWeight: active ? 700 : 600,
            color: active ? accentFg : 'text.primary',
            opacity: active ? 1 : past ? 0.42 : 0.7,
            // a transform never touches layout, so the highlight cannot
            // shift the lines around it while the song plays
            transform: active ? 'scale(1.05)' : 'scale(1)',
            transformOrigin: 'center',
            transition:
              'color 200ms ease, opacity 200ms ease, transform 240ms cubic-bezier(.2,.8,.2,1)',
            // a line the reader tapped keeps :hover (and focus) on touch
            // screens — the highlight has to follow the song, not the
            // finger, so only focus-visible still draws a ring
            '&:hover': { opacity: active ? 1 : past ? 0.5 : 0.85 },
            '&:focus:not(:focus-visible)': { outline: 'none' },
            '&:focus-visible': {
              outline: '2px solid',
              outlineColor: accentFg,
              outlineOffset: 2,
            },
          }}
        >
          {line.content || '♪'}
        </Typography>
      );
    },
    [activeIndex, handleLineClick],
  );

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
      {/* `Lrc` is a plain div component, so it borrows Box's `component`
          slot to receive the sx styling. `position: relative` is load-bearing:
          react-lrc centres a line from its `offsetTop`, which must be measured
          against this scroller rather than the sheet behind it. Overflow and
          smooth scrolling come from the library's own root styles. */}
      <Box
        component={Lrc}
        lrc={lrc}
        currentMillisecond={currentMillisecond}
        lineRenderer={lineRenderer}
        onLineUpdate={handleLineUpdate}
        recoverAutoScrollInterval={RESUME_FOLLOW_MS}
        recoverAutoScrollSingal={signal}
        sx={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          px: { xs: 2, sm: 3 },
          py: 1,
          // room below the last line so it can still travel to the middle
          pb: '30vh',
          // the head and tail of the viewport fade instead of cutting off
          maskImage:
            'linear-gradient(to bottom, transparent 0, black 32px, black calc(100% - 96px), transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent 0, black 32px, black calc(100% - 96px), transparent 100%)',
        }}
      />
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
