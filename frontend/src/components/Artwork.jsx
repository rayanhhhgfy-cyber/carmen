import { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import AlbumIcon from '@mui/icons-material/Album';
import { isArtworkReady, loadArtwork } from '../utils/artwork';

/**
 * Artwork tile that goes through the throttled loader.
 *
 * Instead of letting every `<img>` hit the CDN at once (which is what caused
 * the `429` responses), an image is only queued once it comes near the
 * viewport, then shown as a shimmer while it is fetched and painted only
 * once it sits in the browser cache.  Images that were already fetched during
 * the session appear instantly, wherever they are on the page.
 *
 * @param {string} [src] artwork URL (largest available size)
 */
export default function Artwork({
  src,
  alt = '',
  icon: Icon = AlbumIcon,
  iconSize = 40,
  sx,
  imgSx,
  ...rest
}) {
  const hostRef = useRef(null);
  const [near, setNear] = useState(() => !src || isArtworkReady(src));
  const [status, setStatus] = useState(() => {
    if (!src) return 'empty';
    return isArtworkReady(src) ? 'ready' : 'queued';
  });

  // Only ask the queue for bytes when the tile is about to be shown.
  useEffect(() => {
    if (!src || isArtworkReady(src)) {
      setNear(true);
      return undefined;
    }
    const node = hostRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [src]);

  useEffect(() => {
    if (!src) {
      setStatus('empty');
      return undefined;
    }
    if (isArtworkReady(src)) {
      setStatus('ready');
      return undefined;
    }
    if (!near) {
      setStatus('queued');
      return undefined;
    }
    let alive = true;
    setStatus('queued');
    loadArtwork(src).then((url) => {
      if (alive) setStatus(url ? 'ready' : 'failed');
    });
    return () => {
      alive = false;
    };
  }, [src, near]);

  return (
    <Box
      ref={hostRef}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        bgcolor: 'action.hover',
        ...sx,
      }}
      {...rest}
    >
      {status === 'ready' ? (
        <Box
          component="img"
          src={src}
          alt={alt}
          onError={() => setStatus('failed')}
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            animation: 'artwork-reveal 320ms ease',
            '@keyframes artwork-reveal': {
              from: { opacity: 0, transform: 'scale(1.04)' },
              to: { opacity: 1, transform: 'scale(1)' },
            },
            ...imgSx,
          }}
        />
      ) : (
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: 'text.disabled',
            overflow: 'hidden',
          }}
        >
          {status === 'queued' ? (
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                background:
                  'linear-gradient(100deg, transparent 15%, rgba(128,128,128,0.22) 45%, transparent 75%)',
                animation: 'artwork-shimmer 1.5s linear infinite',
                '@keyframes artwork-shimmer': {
                  from: { transform: 'translateX(-100%)' },
                  to: { transform: 'translateX(100%)' },
                },
              }}
            />
          ) : Icon ? (
            <Icon sx={{ fontSize: iconSize }} />
          ) : null}
        </Box>
      )}
    </Box>
  );
}
