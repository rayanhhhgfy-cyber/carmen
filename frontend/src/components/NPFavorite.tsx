import { useEffect, useRef, useState } from 'react';
import { IconButton, Tooltip } from '@mui/material';

import { toggleFavorite } from '../db/repos/favorites';
import { useFlag } from '../db/flags';
import { useTheme } from '../theme/ThemeContext';
import type { Track } from '../types/models';
import { HeartFilledIcon, HeartIcon } from './icons';

interface NPFavoriteProps {
  track: Track;
  size?: 'small' | 'medium';
}

/**
 * Heart button of the player: reads the shared flags store for the
 * *current* song and flips it in place.
 *
 * The store is hydrated at startup and patched by `toggleFavorite`, so no
 * per-mount database lookup is needed — the heart is correct on the first
 * frame and stays in sync with every other heart in the app. A toggle that
 * lands after the user skipped to another song never paints the wrong song's
 * state (the flags key off the id, not local state), and the fill still pops
 * when it lands — the one moment of feedback the async write cannot give.
 */
export default function NPFavorite({ track, size = 'medium' }: NPFavoriteProps) {
  const favorite = useFlag('favorite', track.videoId);
  // Readable accent: a filled heart in the pinned white accent would vanish
  // on the light player surface (see `accentFg` in ThemeContext).
  const { accentFg } = useTheme();
  const busyRef = useRef(false);
  const [popping, setPopping] = useState(false);

  // One pop per tap: clear the flag once the keyframes are done, otherwise
  // the second heart of the same session would not animate.
  useEffect(() => {
    if (!popping) return undefined;
    const timer = window.setTimeout(() => setPopping(false), 300);
    return () => window.clearTimeout(timer);
  }, [popping]);

  const handleToggle = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const next = await toggleFavorite(track);
      if (next) setPopping(true);
    } catch {
      /* nothing to surface — the repository already fell back internally */
    } finally {
      busyRef.current = false;
    }
  };

  const label = favorite ? 'Remove from favorites' : 'Add to favorites';

  return (
    <Tooltip title={label} placement="top">
      <IconButton
        size={size}
        aria-label={label}
        aria-pressed={favorite}
        onClick={() => void handleToggle()}
        sx={{
          color: favorite ? accentFg : 'text.secondary',
          transition: 'color 160ms ease, transform 160ms ease',
          animation: popping ? 'np-fav-pop 260ms cubic-bezier(.2,.8,.2,1)' : 'none',
          '&:hover': {
            color: favorite ? accentFg : 'text.primary',
            bgcolor: 'action.hover',
          },
          '&:active': { transform: 'scale(0.88)' },
          '@keyframes np-fav-pop': {
            '0%': { transform: 'scale(1)' },
            '55%': { transform: 'scale(1.25)' },
            '100%': { transform: 'scale(1)' },
          },
        }}
      >
        {favorite ? <HeartFilledIcon /> : <HeartIcon />}
      </IconButton>
    </Tooltip>
  );
}
