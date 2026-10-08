import { CircularProgress, Fab, IconButton, Stack } from '@mui/material';
import { alpha } from '@mui/material/styles';

import { usePlayer } from '../player/PlayerContext';
import {
  PauseIcon,
  PlayArrowIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  SkipNextIcon,
  SkipPreviousIcon,
} from './icons';

/**
 * Transport row: shuffle · previous · play/pause · next · repeat.
 *
 * Shuffle and repeat fill with a tint of the accent when they are on, the
 * play button is a round, softly glowing FAB, and it swaps to a spinner
 * whenever the element is buffering — a stall never looks like a frozen
 * pause button.
 *
 * Repeat cycles `off → all → one` through `cycleRepeat`; the "one" state
 * wears the dedicated `RepeatOneIcon` so the mode is readable at a glance.
 */
export default function NPControls() {
  const player = usePlayer();

  return (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="center"
      spacing={{ xs: 0.25, sm: 0.75 }}
      role="group"
      aria-label="Playback controls"
      sx={{ maxWidth: 440, width: '100%', mx: 'auto', mt: 1.5 }}
    >
      <IconButton
        aria-label={player.shuffle ? 'Shuffle on' : 'Shuffle off'}
        aria-pressed={player.shuffle}
        onClick={player.toggleShuffle}
        sx={{
          width: 44,
          height: 44,
          color: player.shuffle ? 'primary.main' : 'text.secondary',
          bgcolor: (t) =>
            player.shuffle ? alpha(t.palette.primary.main, 0.14) : 'transparent',
          transition: 'background-color 160ms ease, color 160ms ease',
          '&:hover': {
            bgcolor: (t) =>
              player.shuffle
                ? alpha(t.palette.primary.main, 0.22)
                : alpha(t.palette.text.primary, 0.08),
          },
        }}
      >
        <ShuffleIcon fontSize="small" />
      </IconButton>

      <IconButton
        aria-label="Previous"
        onClick={player.previous}
        sx={{
          width: 48,
          height: 48,
          color: 'text.primary',
          transition: 'background-color 160ms ease',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <SkipPreviousIcon sx={{ fontSize: 32 }} />
      </IconButton>

      <Fab
        color="primary"
        aria-label={player.isPlaying ? 'Pause' : 'Play'}
        onClick={player.togglePlay}
        sx={{
          width: 66,
          height: 66,
          mx: 1,
          boxShadow: (t) => `0 10px 26px ${alpha(t.palette.primary.main, 0.42)}`,
          transition:
            'transform 160ms cubic-bezier(.2,.8,.2,1), box-shadow 160ms ease',
          '&:hover': {
            transform: 'scale(1.06)',
            boxShadow: (t) => `0 14px 32px ${alpha(t.palette.primary.main, 0.55)}`,
          },
        }}
      >
        {player.buffering ? (
          <CircularProgress size={26} color="inherit" />
        ) : player.isPlaying ? (
          <PauseIcon sx={{ fontSize: 34 }} />
        ) : (
          <PlayArrowIcon sx={{ fontSize: 36 }} />
        )}
      </Fab>

      <IconButton
        aria-label="Next"
        onClick={() => player.next()}
        sx={{
          width: 48,
          height: 48,
          color: 'text.primary',
          transition: 'background-color 160ms ease',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <SkipNextIcon sx={{ fontSize: 32 }} />
      </IconButton>

      <IconButton
        aria-label={`Repeat: ${player.repeat}`}
        aria-pressed={player.repeat !== 'off'}
        onClick={player.cycleRepeat}
        sx={{
          width: 44,
          height: 44,
          color: player.repeat === 'off' ? 'text.secondary' : 'primary.main',
          bgcolor: (t) =>
            player.repeat === 'off'
              ? 'transparent'
              : alpha(t.palette.primary.main, 0.14),
          transition: 'background-color 160ms ease, color 160ms ease',
          '&:hover': {
            bgcolor: (t) =>
              player.repeat === 'off'
                ? alpha(t.palette.text.primary, 0.08)
                : alpha(t.palette.primary.main, 0.22),
          },
        }}
      >
        {player.repeat === 'one' ? (
          <RepeatOneIcon fontSize="small" />
        ) : (
          <RepeatIcon fontSize="small" />
        )}
      </IconButton>
    </Stack>
  );
}
