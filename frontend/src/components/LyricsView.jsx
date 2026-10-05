import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { usePlayer } from '../player/PlayerContext';

const SCROLL_MS = 180;

/**
 * YouTube Music style synced lyrics.
 *
 * Active line follows the audio clock (rAF), is tinted with the accent color
 * (no highlight box) and is kept vertically centered with a fast eased
 * scroll.  Falls back to plain unsynced lyrics when no timestamps exist.
 */
export default function LyricsView({ synced, unsynced, source }) {
  const { audioRef, seek, current } = usePlayer();
  const containerRef = useRef(null);
  const lineRefs = useRef([]);
  const [activeIndex, setActiveIndex] = useState(-1);

  const lines = useMemo(() => {
    if (!Array.isArray(synced)) return [];
    return synced.map((line, position) => ({
      position,
      text: String(line.text ?? '').trim(),
      timeMs: Number(line.timeMs) || 0,
    }));
  }, [synced]);

  const hasSynced = lines.length > 0;

  useEffect(() => {
    if (!hasSynced) {
      setActiveIndex(-1);
      return undefined;
    }
    let frame = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) {
        const elapsed = audio.currentTime * 1000;
        let index = -1;
        for (let i = 0; i < lines.length; i += 1) {
          if (lines[i].timeMs <= elapsed) index = i;
          else break;
        }
        setActiveIndex((previous) => (previous === index ? previous : index));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [lines, hasSynced, audioRef]);

  /**
   * Keep the active line centered inside the scrollable lyrics area.
   *
   * The browser's native smooth scroll takes the better part of a second to
   * cover the 40vh padding this list has, which reads as "the lyrics are
   * lagging behind the song".  A short eased tween lands on the line before
   * the next word is sung while still gliding instead of jump-cutting.
   */
  useEffect(() => {
    if (activeIndex < 0) return undefined;
    const container = containerRef.current;
    const element = lineRefs.current[activeIndex];
    if (!container || !element) return undefined;
    const from = container.scrollTop;
    const to = Math.max(
      0,
      element.offsetTop - container.clientHeight / 2 + element.offsetHeight / 2,
    );
    const delta = to - from;
    if (Math.abs(delta) < 1) return undefined;

    const startedAt = performance.now();
    let frame = 0;
    const step = (now) => {
      const t = Math.min(1, (now - startedAt) / SCROLL_MS);
      container.scrollTop = from + delta * (1 - (1 - t) ** 3);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [activeIndex]);

  if (!hasSynced) {
    if (!unsynced) {
      return (
        <Stack spacing={1} alignItems="center" justifyContent="center" sx={{ py: 6, px: 3 }}>
          <Typography variant="subtitle1" color="text.secondary" textAlign="center">
            No lyrics available for this song
          </Typography>
          <Typography variant="caption" color="text.disabled" textAlign="center">
            {current?.title}
          </Typography>
        </Stack>
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
    <Box
      ref={containerRef}
      sx={{
        position: 'relative',
        height: '100%',
        overflowY: 'auto',
        px: 2,
        py: 1,
        overscrollBehavior: 'contain',
        maskImage:
          'linear-gradient(to bottom, transparent, black 8%, black 88%, transparent)',
        WebkitMaskImage:
          'linear-gradient(to bottom, transparent, black 8%, black 88%, transparent)',
      }}
    >
      <Stack spacing={1.5} sx={{ py: '40vh' }}>
        {lines.map((line, index) => {
          const active = index === activeIndex;
          const past = activeIndex >= 0 && index < activeIndex;
          return (
            <Typography
              key={`${line.timeMs}-${index}`}
              component="button"
              type="button"
              aria-current={active || undefined}
              onClick={() => seek(line.timeMs / 1000)}
              ref={(element) => {
                lineRefs.current[index] = element;
              }}
              sx={{
                border: 'none',
                // No highlight box behind the current line: it is marked by
                // colour alone, so nothing on screen ever shifts or resizes
                // while the song plays.
                background: 'none',
                p: 1.25,
                m: 0,
                borderRadius: 2,
                textAlign: 'center',
                cursor: 'pointer',
                fontFamily: 'inherit',
                lineHeight: 1.4,
                fontSize: { xs: '1.15rem', md: '1.2rem' },
                fontWeight: active ? 700 : 500,
                color: active ? 'primary.main' : 'text.primary',
                opacity: active ? 1 : past ? 0.42 : 0.3,
                transition: 'color 160ms ease, opacity 160ms ease, font-weight 160ms ease',
                '&:hover': { opacity: active ? 1 : 0.75 },
              }}
            >
              {line.text || '♪'}
            </Typography>
          );
        })}
      </Stack>
      {source && (
        <Typography
          variant="caption"
          color="text.disabled"
          sx={{ display: 'block', textAlign: 'center', pb: 3 }}
        >
          {source}
        </Typography>
      )}
    </Box>
  );
}
