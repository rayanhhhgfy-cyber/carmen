import { useEffect, useState } from 'react';
import { Box, alpha, useTheme } from '@mui/material';

import { usePlayer } from '../player/PlayerContext';
import { pickArtwork, primaryArtwork } from '../utils/track';
import { extractColor, loadArtwork } from '../utils/artwork';

/**
 * Site wide ambient background.
 *
 * A blurred copy of the artwork that is currently playing bleeds through the
 * whole interface, and its dominant color is pulled out (tiny canvas pass) to
 * tint a second layer on top.  Everything cross-fades so switching tracks
 * feels like the room changes color instead of the page reloading.
 *
 * The image itself goes through the throttled artwork queue, so this layer
 * never contributes to the CDN rate limiting.
 */
export default function AmbientBackground() {
  const player = usePlayer();
  const theme = useTheme();
  const artwork =
    primaryArtwork(player.current) || pickArtwork(player.meta?.thumbnails);

  const [src, setSrc] = useState(null);
  const [color, setColor] = useState(null);
  const dark = theme.palette.mode === 'dark';

  useEffect(() => {
    if (!artwork) {
      setSrc(null);
      setColor(null);
      return undefined;
    }
    let alive = true;
    loadArtwork(artwork).then((url) => {
      if (alive) setSrc(url);
    });
    // the color pass runs after the bytes are in the browser cache
    const timer = setTimeout(() => {
      extractColor(artwork).then((value) => {
        if (alive && value) setColor(value);
      });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [artwork]);

  return (
    <Box
      aria-hidden
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: -1,
        overflow: 'hidden',
        pointerEvents: 'none',
        opacity: src ? 1 : 0,
        transition: 'opacity 700ms ease',
      }}
    >
      {src && (
        <Box
          component="img"
          src={src}
          alt=""
          sx={{
            position: 'absolute',
            top: '-15%',
            left: '-15%',
            width: '130%',
            height: '130%',
            objectFit: 'cover',
            filter: 'blur(110px) saturate(1.7)',
            opacity: dark ? 0.5 : 0.34,
            transform: 'scale(1.06)',
          }}
        />
      )}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          bgcolor: color ? alpha(color, dark ? 0.16 : 0.12) : 'transparent',
          transition: 'background-color 700ms ease',
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background: dark
            ? 'linear-gradient(180deg, rgba(10,13,11,0.62) 0%, rgba(10,13,11,0.86) 55%, rgba(10,13,11,0.95) 100%)'
            : 'linear-gradient(180deg, rgba(246,247,246,0.7) 0%, rgba(246,247,246,0.88) 55%, rgba(246,247,246,0.95) 100%)',
        }}
      />
    </Box>
  );
}
