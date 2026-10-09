import { Fab, IconButton, Spinner } from '../components/ui';

import { usePlayer } from '../player/PlayerContext';
import { useEffectsEnabled } from '../settings/store';
import { alpha } from '../utils/color';
import { cn } from '../utils/cn';
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
  // The FAB's accent glow is a painted effect — flat while low battery
  // mode is on.
  const effectsEnabled = useEffectsEnabled();
  // Shuffle / repeat icons are line art on the sheet — the `accent-fg`
  // tokens below are ThemeContext's readable accent, which keeps them
  // visible when the mode pins the accent to white.

  return (
    <div
      role="group"
      aria-label="Playback controls"
      className="mx-auto mt-3 flex w-full max-w-[440px] items-center justify-center gap-[2px] sm:gap-[6px]"
    >
      <IconButton
        aria-label={player.shuffle ? 'Shuffle on' : 'Shuffle off'}
        aria-pressed={player.shuffle}
        onClick={player.toggleShuffle}
        className={cn(
          'size-11 ![transition:background-color_160ms_ease,color_160ms_ease]',
          player.shuffle
            ? '!bg-accent-fg/14 !text-accent-fg hover:!bg-accent-fg/22'
            : '!text-muted hover:!bg-[color-mix(in_srgb,var(--app-text)_8%,transparent)]',
        )}
      >
        <ShuffleIcon fontSize="small" />
      </IconButton>

      <IconButton
        aria-label="Previous"
        onClick={player.previous}
        className="size-12 !text-body"
      >
        <SkipPreviousIcon sx={{ fontSize: 32 }} />
      </IconButton>

      <Fab
        aria-label={player.isPlaying ? 'Pause' : 'Play'}
        onClick={player.togglePlay}
        className={cn(
          'mx-2 size-[66px]',
          '![transition:transform_160ms_cubic-bezier(.2,.8,.2,1),box-shadow_160ms_ease]',
          'hover:[transform:scale(1.06)]',
          effectsEnabled &&
            'hover:![box-shadow:0_14px_32px_color-mix(in_srgb,var(--app-accent)_55%,transparent)]',
        )}
        style={{
          boxShadow: effectsEnabled
            ? `0 10px 26px ${alpha('var(--app-accent)', 0.42)}`
            : 'none',
        }}
      >
        {player.buffering ? (
          <Spinner size={26} color="inherit" />
        ) : player.isPlaying ? (
          <PauseIcon sx={{ fontSize: 34 }} />
        ) : (
          <PlayArrowIcon sx={{ fontSize: 36 }} />
        )}
      </Fab>

      <IconButton
        aria-label="Next"
        onClick={() => player.next()}
        className="size-12 !text-body"
      >
        <SkipNextIcon sx={{ fontSize: 32 }} />
      </IconButton>

      <IconButton
        aria-label={`Repeat: ${player.repeat}`}
        aria-pressed={player.repeat !== 'off'}
        onClick={player.cycleRepeat}
        className={cn(
          'size-11 ![transition:background-color_160ms_ease,color_160ms_ease]',
          player.repeat === 'off'
            ? '!text-muted hover:!bg-[color-mix(in_srgb,var(--app-text)_8%,transparent)]'
            : '!bg-accent-fg/14 !text-accent-fg hover:!bg-accent-fg/22',
        )}
      >
        {player.repeat === 'one' ? (
          <RepeatOneIcon fontSize="small" />
        ) : (
          <RepeatIcon fontSize="small" />
        )}
      </IconButton>
    </div>
  );
}
