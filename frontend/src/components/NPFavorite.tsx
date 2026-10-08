import { useEffect, useRef, useState } from 'react';
import { IconButton, Tooltip } from '@mui/material';

import { isFavorite, toggleFavorite } from '../db/repos/favorites';
import type { Track } from '../types/models';
import { HeartFilledIcon, HeartIcon } from './icons';

interface NPFavoriteProps {
  track: Track;
  size?: 'small' | 'medium';
}

/**
 * Heart button of the player: reads the favorites repository for the
 * *current* song and flips it in place.
 *
 * The repository is async (SQLite, with an in-memory fallback while the
 * database is still opening), so two guards keep the UI honest:
 * the lookup of a track that changed underneath is dropped, and a toggle
 * that lands after the user skipped to another song never paints the wrong
 * song's state.  The fill also pops when the heart lands — the one moment
 * of feedback the async write cannot give by itself.
 */
export default function NPFavorite({ track, size = 'medium' }: NPFavoriteProps) {
  const [favorite, setFavorite] = useState(false);
  const busyRef = useRef(false);
  /** The song the async answers below still belong to. */
  const trackIdRef = useRef(track.videoId);

  trackIdRef.current = track.videoId;

  useEffect(() => {
    let alive = true;
    // a new song always starts from "not favorited" until it is looked up
    setFavorite(false);
    isFavorite(track.videoId)
      .then((value) => {
        if (alive) setFavorite(value);
      })
      .catch(() => {
        /* the repository falls back to memory; the heart simply stays off */
      });
    return () => {
      alive = false;
    };
  }, [track.videoId]);

  const handleToggle = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    const videoId = track.videoId;
    try {
      const next = await toggleFavorite(track);
      // only paint if the user is still on the song this toggle belonged to
      if (trackIdRef.current === videoId) setFavorite(next);
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
          color: favorite ? 'primary.main' : 'text.secondary',
          transition: 'color 160ms ease, transform 160ms ease',
          animation: favorite ? 'np-fav-pop 260ms cubic-bezier(.2,.8,.2,1)' : 'none',
          '&:hover': {
            color: favorite ? 'primary.main' : 'text.primary',
            bgcolor: 'action.hover',
          },
          '&:active': { transform: 'scale(0.88)' },
          '@keyframes np-fav-pop': {
            '0%': { transform: 'scale(0.6)' },
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
