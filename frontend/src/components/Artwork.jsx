import { useEffect, useMemo, useRef, useState } from 'react';
import { Box } from '@mui/material';
import AlbumIcon from '@mui/icons-material/Album';
import { artworkFallbacks, isArtworkReady, loadArtwork } from '../utils/artwork';

/**
 * Artwork tile that goes through the throttled loader.
 *
 * Instead of letting every `<img>` hit the CDN at once (which is what caused
 * the `429` responses), an image is only queued once it comes near the
 * viewport, then shown as a shimmer while it is fetched and painted only
 * once it sits in the browser cache.  Images that were already fetched during
 * the session appear instantly, wherever they are on the page.
 *
 * The cover is always square: the source frame is 16:9 (`maxresdefault`), so
 * `object-fit: cover` does the 1:1 cut right here in the browser instead of
 * shipping a resized image from the server.
 *
 * Sizes that do not exist on the CDN walk down a fixed chain
 * (`maxresdefault.jpg` → `hq720.jpg` → … → `hqdefault.jpg` — always JPEG,
 * the WebP twin never renders), never back to a URL that already failed.
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

  // Ordered candidates for this artwork; index 0 is the one we want.
  const chain = useMemo(() => (src ? [src, ...artworkFallbacks(src)] : []), [src]);
  const [step, setStep] = useState(0);
  const [near, setNear] = useState(() => !src || isArtworkReady(src));
  const [status, setStatus] = useState(() => {
    if (!src) return 'empty';
    return isArtworkReady(src) ? 'ready' : 'queued';
  });

  const active = chain[Math.min(step, Math.max(chain.length - 1, 0))] || null;

  // A new artwork restarts the chain at its best size.
  useEffect(() => {
    setStep(0);
    setStatus(() => {
      if (!src) return 'empty';
      return isArtworkReady(src) ? 'ready' : 'queued';
    });
  }, [src]);

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

  /** Walk to the next size of the chain, or give up. */
  const nextOrGiveUp = () => {
    if (step + 1 < chain.length) setStep(step + 1);
    else setStatus('failed');
  };

  useEffect(() => {
    if (!active) {
      setStatus('empty');
      return undefined;
    }
    if (isArtworkReady(active)) {
      setStatus('ready');
      return undefined;
    }
    if (!near) {
      setStatus('queued');
      return undefined;
    }
    let alive = true;
    setStatus('queued');
    loadArtwork(active).then((url) => {
      if (!alive) return;
      if (url) {
        setStatus('ready');
        return;
      }
      // this size does not exist — walk to the next one of the chain
      if (step + 1 < chain.length) setStep(step + 1);
      else setStatus('failed');
    });
    return () => {
      alive = false;
    };
  }, [active, near, chain.length, step]);

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
      {status === 'ready' && active ? (
        <Box
          component="img"
          src={active}
          alt={alt}
          onError={nextOrGiveUp}
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center',
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
