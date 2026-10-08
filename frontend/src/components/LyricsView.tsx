import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Skeleton, Typography } from '@mui/material';

import { usePlayer } from '../player/PlayerContext';
import type { LyricLine } from '../types/models';

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
 * **Following the song.** The active line is the last one whose timestamp
 * has already been passed; the container only re-centres when *that index
 * changes*, never on every `timeupdate`, so the panel glides once per line
 * instead of jittering sixty times a second.  A wheel or touch gesture from
 * the reader suspends the follow for a couple of seconds, and a tapped line
 * seeks the song there (`line.timeMs / 1000`) and re-centres straight away.
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
  const { seek, currentTime, current } = usePlayer();

  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** Line nodes by index — `HTMLElement` because Typography erases `button`. */
  const lineRefs = useRef<Array<HTMLElement | null>>([]);
  /** Wall clock of the reader's last own gesture (wheel / finger). */
  const lastUserGesture = useRef(0);
  /** The first follow of a fresh lyric sheet lands without animation. */
  const firstFollow = useRef(true);

  const [timedOut, setTimedOut] = useState(false);

  /** Defensive copy of the payload lines (bad timestamps become `0`). */
  const lines = useMemo<LyricLine[]>(() => {
    if (!Array.isArray(synced)) return [];
    return synced.map((line) => ({
      timeMs: Number(line?.timeMs) || 0,
      text: String(line?.text ?? '').trim(),
    }));
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

  /** Index of the last line whose start time has already been passed. */
  const activeIndex = useMemo(() => {
    if (!lines.length) return -1;
    const ms = Math.max(0, currentTime) * 1000;
    let index = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].timeMs <= ms) index = i;
      else break;
    }
    return index;
  }, [lines, currentTime]);

  /** Scroll the container so `index` sits in the vertical middle. */
  const centerLine = useCallback((index: number, smooth: boolean) => {
    const container = scrollRef.current;
    const line = lineRefs.current[index];
    if (!container || !line) return;
    const top = line.offsetTop - (container.clientHeight - line.offsetHeight) / 2;
    container.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // A new lyric sheet starts at the very top and its follow restarts:
  // fresh line nodes, fresh centreing on whatever is playing right now.
  useEffect(() => {
    lineRefs.current = [];
    firstFollow.current = true;
    scrollRef.current?.scrollTo({ top: 0 });
  }, [lines]);

  // Follow the song. This effect keys on the *line index* (and the line
  // list), not on `currentTime` — one scroll per lyric line, nothing in
  // between — and stands down while the reader is scrolling themselves.
  useEffect(() => {
    if (activeIndex < 0) return;
    const smooth = !firstFollow.current;
    firstFollow.current = false;
    if (Date.now() - lastUserGesture.current < RESUME_FOLLOW_MS) return;
    centerLine(activeIndex, smooth);
  }, [activeIndex, lines, centerLine]);

  // A plain-text page always opens at the first verse.
  useEffect(() => {
    if (hasSynced) return;
    scrollRef.current?.scrollTo({ top: 0 });
  }, [unsynced, hasSynced]);

  /** Wheel / finger on the panel = the reader took over for a moment. */
  const markUserGesture = useCallback(() => {
    lastUserGesture.current = Date.now();
  }, []);

  const handleLineClick = useCallback(
    (index: number) => {
      const line = lines[index];
      if (!line) return;
      // the tap *is* the decision — resume following this line immediately
      lastUserGesture.current = 0;
      seek(line.timeMs / 1000);
      centerLine(index, true);
    },
    [lines, seek, centerLine],
  );

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
        onWheel={markUserGesture}
        onTouchMove={markUserGesture}
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
      <Box
        ref={scrollRef}
        onWheel={markUserGesture}
        onTouchMove={markUserGesture}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
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
      >
        {lines.map((line, index) => {
          const active = index === activeIndex;
          const past = !active && index < activeIndex;
          return (
            <Typography
              key={`${line.timeMs}-${index}`}
              component="button"
              type="button"
              ref={(node) => {
                lineRefs.current[index] = node;
              }}
              aria-current={active || undefined}
              onClick={() => handleLineClick(index)}
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
                color: active ? 'primary.main' : 'text.primary',
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
                  outlineColor: 'primary.main',
                  outlineOffset: 2,
                },
              }}
            >
              {line.text || '♪'}
            </Typography>
          );
        })}
      </Box>
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
