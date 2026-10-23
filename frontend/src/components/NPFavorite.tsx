import { useEffect, useRef, useState } from 'react';
import { IconButton, Tooltip } from '../components/ui';

import { toggleFavorite } from '../db/repos/favorites';
import { useFlag } from '../db/flags';
import type { Track } from '../types/models';
import { cn } from '../utils/cn';
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
  // on the light player surface — the `text-accent-fg` token below carries
  // ThemeContext's `accentFg`.
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
    // MIGRATION: MUI used to inject `@keyframes np-fav-pop` through the sx
    // object (`'@keyframes np-fav-pop': {...}`); `styles.css` is off limits
    // in this migration, so the keyframes travel with the component in a
    // <style> element instead (same pattern as SongRow's `row-eq`).
    <>
      <style>
        {'@keyframes np-fav-pop{0%{transform:scale(1)}55%{transform:scale(1.25)}100%{transform:scale(1)}}'}
      </style>
      <Tooltip title={label} placement="top">
        <IconButton
          size={size}
          aria-label={label}
          aria-pressed={favorite}
          onClick={() => void handleToggle()}
          className={cn(
            // 44px touch area either size (the kit box was 40px at
            // `medium`, 30px at `small`) — the glyph keeps its size.
            'size-11 shrink-0',
            '![transition:color_160ms_ease,transform_160ms_ease]',
            'active:[transform:scale(0.88)]',
            favorite
              ? '!text-accent-fg'
              : '!text-muted hover:!text-body',
            popping && 'animate-[np-fav-pop_260ms_cubic-bezier(.2,.8,.2,1)]',
          )}
        >
          {favorite ? <HeartFilledIcon /> : <HeartIcon />}
        </IconButton>
      </Tooltip>
    </>
  );
}
