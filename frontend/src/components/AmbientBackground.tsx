import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import { usePlayer } from '../player/PlayerContext';
import { useTheme } from '../theme/ThemeContext';
import { pickArtwork, primaryArtwork } from '../utils/track';
import { extractColor, loadArtwork } from '../utils/artwork';
import { alpha } from '../utils/color';

/**
 * How long one cover washes out as the next washes in — inside the spec's
 * 1–1.5s window for a background that reads as the room changing color.
 */
const WASH_MS = 1.2;

/** Geometry of a wash layer: oversized + blurred so edges never show. */
const LAYER_STYLE: CSSProperties = {
  position: 'absolute',
  top: '-15%',
  left: '-15%',
  width: '130%',
  height: '130%',
  objectFit: 'cover',
  filter: 'blur(110px) saturate(1.7)',
  transform: 'scale(1.06)',
};

/**
 * Site wide ambient background.
 *
 * A blurred copy of the artwork that is currently playing bleeds through the
 * whole interface, and its dominant color is pulled out (tiny canvas pass,
 * cached per cover — see `extractColor`) to tint a second layer on top.
 *
 * **The wash cross-fades.**  The layer stack holds the outgoing and the
 * incoming cover at once — same DOM node keyed by URL, so framer eases the
 * old one to transparent while the new one eases in, 1.2s each, no pop and
 * no flash of the placeholder underneath.  The tint layer slides its
 * `background-color` on the same beat through a plain CSS transition.
 *
 * The artwork contribution runs at **50%** strength — image and tint are half
 * the opacity they would otherwise be — so the interface stays the thing you
 * read and the cover is only a suggestion of mood.  The neutral scrim over
 * it stays full strength to keep text readable.
 *
 * The image itself goes through the throttled artwork queue, so this layer
 * never contributes to the CDN rate limiting.
 */
export default function AmbientBackground() {
  const player = usePlayer();
  const { resolved } = useTheme();
  // `pickArtwork` takes any candidate shape; wrapping the thumbnail list in
  // `{ thumbnails }` keeps the same selection as passing the array itself.
  const artwork =
    primaryArtwork(player.current) || pickArtwork({ thumbnails: player.meta?.thumbnails });

  /** The cover currently owning the top layer. */
  const [wash, setWash] = useState<string | null>(null);
  /** The cover the top layer replaced — kept mounted until it fades out. */
  const [fading, setFading] = useState<string | null>(null);
  /** What the DOM is actually showing — guards double-resolves and races. */
  const paintedRef = useRef<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const dark = resolved === 'dark';
  const washOpacity = dark ? 0.25 : 0.17;

  useEffect(() => {
    if (!artwork) {
      paintedRef.current = null;
      setWash(null);
      setFading(null);
      setColor(null);
      return undefined;
    }
    let alive = true;
    loadArtwork(artwork).then((url) => {
      // A stale load must never paint over a newer track's wash, and the
      // same bytes (revisit, StrictMode double run) are a no-op.
      if (!alive || !url || url === paintedRef.current) return;
      const outgoing = paintedRef.current;
      paintedRef.current = url;
      setFading(outgoing);
      setWash(url);
    });
    // the color pass runs after the bytes are in the browser cache; the
    // extraction itself is cached per cover (extractColor), so coming back
    // to a track is instant and costs no canvas work at all
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

  /** Outgoing first (painted below), incoming on top; never the same URL twice. */
  const layers = wash ? (fading && fading !== wash ? [fading, wash] : [wash]) : fading ? [fading] : [];

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[-1] overflow-hidden"
      style={{
        opacity: wash || fading ? 1 : 0,
        // 1.2s: slow enough to read as the room changing color when a new
        // track starts, fast enough to feel tied to it (spec window: 1–1.5s)
        transition: 'opacity 1200ms ease',
      }}
    >
      <AnimatePresence>
        {layers.map((url) => (
          <motion.img
            key={url}
            src={url}
            alt=""
            initial={{ opacity: 0 }}
            animate={{ opacity: url === wash ? washOpacity : 0 }}
            exit={{ opacity: 0, transition: { duration: WASH_MS } }}
            transition={{ duration: WASH_MS, ease: 'easeInOut' }}
            style={LAYER_STYLE}
          />
        ))}
      </AnimatePresence>
      <div
        className="absolute inset-0"
        style={{
          // half the extracted cover colour as well — 50% artwork theme
          backgroundColor: color ? alpha(color, dark ? 0.08 : 0.06) : 'transparent',
          // same 1.2s beat as the wash above, so both move as one
          transition: 'background-color 1200ms ease',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: dark
            ? 'linear-gradient(180deg, rgba(10,13,11,0.62) 0%, rgba(10,13,11,0.86) 55%, rgba(10,13,11,0.95) 100%)'
            : 'linear-gradient(180deg, rgba(246,247,246,0.7) 0%, rgba(246,247,246,0.88) 55%, rgba(246,247,246,0.95) 100%)',
        }}
      />
    </div>
  );
}
