import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { Lrc, useRecoverAutoScrollImmediately } from 'react-lrc';
import { usePlayer } from '../player/PlayerContext';
import { toLrc } from '../utils/lyrics';

/**
 * YouTube Music style synced lyrics, rendered by `react-lrc`.
 *
 * The component owns the hard parts: it parses the LRC, finds the line that
 * matches the clock and auto-scrolls to it with the browser's smooth
 * scrolling, pausing while the reader scrolls and picking the song up again
 * a few seconds later.  That is much smoother and cheaper than the hand
 * rolled tween this replaced.
 *
 * We only hand it the clock at the moment a line starts (one state update
 * per line instead of sixty per second) and paint the active line with the
 * accent colour — no highlight box, nothing that shifts while the song
 * plays.  The list starts at the very top of the panel: no 40vh of empty
 * space, so the first line is the first thing you see.
 *
 * Falls back to plain unsynced lyrics when no timestamps exist.
 */

/** Scroll container of `react-lrc` (the component merges its own defaults). */
const LRC_STYLE = {
  flex: 1,
  minHeight: 0,
  // lines measure themselves against the scroller to auto scroll
  position: 'relative',
  padding: '8px 16px 30vh',
  // only the tail fades: the list itself starts at the very top
  maskImage: 'linear-gradient(to bottom, black 86%, transparent)',
  WebkitMaskImage: 'linear-gradient(to bottom, black 86%, transparent)',
};

export default function LyricsView({ synced, unsynced, source }) {
  const { audioRef, seek, current } = usePlayer();
  const [currentMillisecond, setCurrentMillisecond] = useState(-1);
  // tapping a line counts as user scrolling — resume following straight away
  const { signal, recoverAutoScrollImmediately } = useRecoverAutoScrollImmediately();

  const lines = useMemo(() => {
    if (!Array.isArray(synced)) return [];
    return synced.map((line, position) => ({
      position,
      text: String(line.text ?? '').trim(),
      timeMs: Number(line.timeMs) || 0,
    }));
  }, [synced]);

  const hasSynced = lines.length > 0;
  const lrc = useMemo(() => toLrc(lines), [lines]);

  /**
   * Follow the audio clock.
   *
   * `react-lrc` derives everything from one number, so the list only needs
   * to hear about it when a new line starts: the re-render (and the scroll)
   * happen on the exact frame the line becomes current, with nothing in
   * between.
   */
  useEffect(() => {
    if (!hasSynced) return undefined;
    setCurrentMillisecond(-1);
    let frame = 0;
    let lastIndex = null;

    const tick = () => {
      const audio = audioRef.current;
      if (audio) {
        const ms = Math.max(0, audio.currentTime * 1000);
        let index = -1;
        for (let i = 0; i < lines.length; i += 1) {
          if (lines[i].timeMs <= ms) index = i;
          else break;
        }
        if (index !== lastIndex) {
          lastIndex = index;
          setCurrentMillisecond(index < 0 ? -1 : ms);
        }
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [lines, hasSynced, audioRef]);

  const lineRenderer = useCallback(
    ({ active, line }) => {
      // `currentMillisecond` only ever sits on a line start, so anything
      // that started before it belongs to an earlier line.
      const past = !active && line.startMillisecond <= currentMillisecond;
      return (
        <Typography
          component="button"
          type="button"
          aria-current={active || undefined}
          onClick={() => {
            seek(line.startMillisecond / 1000);
            recoverAutoScrollImmediately();
          }}
          sx={{
            border: 'none',
            // No highlight box behind the current line: it is marked by
            // colour alone, so nothing on screen ever shifts or resizes
            // while the song plays.
            background: 'none',
            p: 1.25,
            m: 0,
            display: 'block',
            width: '100%',
            borderRadius: 2,
            textAlign: 'center',
            cursor: 'pointer',
            fontFamily: 'inherit',
            lineHeight: 1.4,
            fontSize: { xs: '1.15rem', md: '1.2rem' },
            // one weight for every line: changing it reflows the text
            // mid-song and is what makes the highlight look jumpy
            fontWeight: 600,
            color: active ? 'primary.main' : 'text.primary',
            opacity: active ? 1 : past ? 0.42 : 0.3,
            transition: 'color 150ms ease, opacity 150ms ease',
            // A line the reader tapped keeps `:hover` (and focus) on touch
            // screens, and `:focus` rings stay behind after a tap — the
            // highlight has to follow the song, not the finger, so a line
            // that has already been and gone never brightens again and only
            // the keyboard still draws a ring.
            '&:hover': { opacity: active ? 1 : past ? 0.42 : 0.75 },
            '&:focus:not(:focus-visible)': { outline: 'none' },
            '&:focus-visible': {
              outline: '2px solid',
              outlineColor: 'primary.main',
              outlineOffset: 2,
            },
          }}
        >
          {line.content || '♪'}
        </Typography>
      );
    },
    [currentMillisecond, seek, recoverAutoScrollImmediately],
  );

  if (!hasSynced) {
    if (!unsynced) {
      return (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 6, px: 3, height: '100%' }}>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="subtitle1" color="text.secondary">
              No lyrics available for this song
            </Typography>
            <Typography variant="caption" color="text.disabled">
              {current?.title}
            </Typography>
          </Box>
        </Box>
      );
    }

    return (
      <Box
        sx={{
          overflowY: 'auto',
          height: '100%',
          px: 3,
          py: 2,
          maskImage: 'linear-gradient(to bottom, transparent, black 8%, black 92%, transparent)',
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
          <Typography variant="caption" color="text.disabled" textAlign="center" sx={{ display: 'block', mt: 2 }}>
            {source}
          </Typography>
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Lrc
        lrc={lrc}
        currentMillisecond={currentMillisecond}
        lineRenderer={lineRenderer}
        recoverAutoScrollSingal={signal}
        style={LRC_STYLE}
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
