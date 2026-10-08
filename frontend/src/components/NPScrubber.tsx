import { useState } from 'react';
import { Box, LinearProgress, Slider, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';

import { useEffectsEnabled } from '../settings/store';
import { usePlayhead, usePlayer } from '../player/PlayerContext';
import { useTheme } from '../theme/ThemeContext';
import { formatTime } from '../utils/format';

interface NPScrubberProps {
  onSeek: (seconds: number) => void;
}

/** MUI sliders report `number | number[]`; the seek bar is never a range. */
function scalar(value: number | number[], fallback = 0): number {
  return Array.isArray(value) ? (value[0] ?? fallback) : value;
}

/**
 * Seek bar of the now-playing screen.
 *
 * A hairline rail that fattens under the pointer, the buffered range in a
 * muted tint and a glowing accent track — the thumb only shows up while the
 * bar is hovered, focused or dragged (the modern desktop player treatment
 * instead of a permanently visible slider dot).
 *
 * While a gesture is in flight the bar keeps a *tentative* position in
 * local state, so it never snaps back to the real playhead under the
 * finger; the seek is only sent when the gesture commits.
 * `onChangeCommitted` also fires for keyboard changes (arrow / page / home
 * / end keys), so the bar stays fully keyboard operable.
 */
export default function NPScrubber({ onSeek }: NPScrubberProps) {
  // The playhead lives in its own context (`usePlayhead`), so these
  // per-tick updates repaint just this bar — never the whole player.
  const { currentTime, duration: audioDuration, buffered } = usePlayhead();
  // Until the audio reports its own length (metadata lands in
  // milliseconds), fall back to what the track metadata already knows.
  const { current } = usePlayer();
  const duration = audioDuration || current?.durationSeconds || 0;
  const [scrub, setScrub] = useState<number | null>(null);
  // The glowing accent track is a painted effect — flat while high
  // performance mode is on.
  const effectsEnabled = useEffectsEnabled();
  // The rail, glow and thumb ring are line art on the sheet surface — use the
  // readable accent so a white high-performance accent stays visible in light
  // mode (filled surfaces can keep `primary.main`).
  const { accentFg } = useTheme();

  const progress = duration ? Math.min(Math.max(scrub ?? currentTime, 0), duration) : 0;
  const bufferedFraction = duration ? Math.min(Math.max(buffered, 0) / duration, 1) : 0;
  const elapsed = scrub ?? currentTime;

  return (
    <Box sx={{ mt: 2.5 }}>
      <Box
        sx={{
          position: 'relative',
          '& .seek-rail, & .seek-buffer': { transition: 'height 140ms ease' },
          '&:hover, &:focus-within': {
            '& .seek-rail, & .seek-buffer': { height: 6 },
          },
        }}
      >
        {/* empty rail */}
        <Box
          aria-hidden
          className="seek-rail"
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            height: 4,
            borderRadius: 3,
            bgcolor: 'action.hover',
            pointerEvents: 'none',
          }}
        />
        {/* buffered range, painted behind the thumb */}
        <Box
          aria-hidden
          className="seek-buffer"
          sx={{
            position: 'absolute',
            left: 0,
            width: `${bufferedFraction * 100}%`,
            top: '50%',
            transform: 'translateY(-50%)',
            height: 4,
            borderRadius: 3,
            bgcolor: (t) => alpha(t.palette.text.primary, 0.16),
            pointerEvents: 'none',
            transition: 'width 300ms linear, height 140ms ease',
          }}
        />
        {duration ? (
          <Slider
            size="small"
            value={progress}
            max={duration}
            step={0.5}
            aria-label="Seek"
            onChange={(_, value) => setScrub(scalar(value, progress))}
            onChangeCommitted={(_, value) => {
              onSeek(scalar(value, progress));
              setScrub(null);
            }}
            sx={{
              position: 'relative',
              color: accentFg,
              py: 1.25,
              '& .MuiSlider-rail': { bgcolor: 'transparent', opacity: 1 },
              '& .MuiSlider-track': {
                border: 0,
                height: 4,
                borderRadius: 3,
                boxShadow: effectsEnabled ? `0 0 10px ${alpha(accentFg, 0.55)}` : 'none',
              },
              '& .MuiSlider-thumb': {
                width: 12,
                height: 12,
                bgcolor: 'background.paper',
                border: `3px solid ${accentFg}`,
                boxShadow: 'none',
                opacity: 0,
                scale: '0.5',
                transition: 'opacity 140ms ease, scale 140ms ease',
                '&:hover, &.MuiSlider-active': { opacity: 1, scale: '1' },
              },
              '&:hover .MuiSlider-thumb, &:focus-visible .MuiSlider-thumb': {
                opacity: 1,
                scale: '1',
              },
            }}
          />
        ) : (
          /* no duration yet: the indeterminate bar says "loading" instead of
             pretending the song is one pixel long */
          <LinearProgress sx={{ borderRadius: 3, height: 4, bgcolor: 'action.hover' }} />
        )}
      </Box>
      <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.25 }}>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {formatTime(elapsed)}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {duration ? formatTime(duration) : '--:--'}
        </Typography>
      </Stack>
    </Box>
  );
}
