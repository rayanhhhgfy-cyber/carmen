import { useEffect } from 'react';

import type { Track } from '../types/models';
import { cdnArtwork } from '../utils/track';
import { pickAccentColor } from './color';
import { useTheme } from './ThemeContext';

/**
 * Adaptive accent colour: the accent follows the cover of whatever is
 * playing.
 *
 * The artwork is read back through a canvas (see {@link extractAccent}) and
 * the colour the record most *is* becomes the theme's `primary.main` — so
 * buttons, active lines, the seek bar and the lyrics highlight all pick up the
 * palette of the record the user is listening to.  What counts as "is" is
 * decided in {@link pickAccentColor}, over here only the pixels are gathered:
 * the square the UI itself draws, at a size cheap enough to run on every
 * track change.
 *
 * The switch lives in Settings; the chosen accent is what falls back to
 * whenever the switch is off or nothing is playing.
 */

/** Artwork is sampled this small: cheap enough to run on every track change. */
const SAMPLE_SIZE = 48;

/** Covers sampled this often are kept — a song you go back to is free. */
const CACHE_LIMIT = 64;

/** Answers keyed by cover URL, so one track never pays twice. */
const cache = new Map<string, Promise<string | null>>();

/**
 * Read the dominant colour out of an image URL.
 *
 * `crossOrigin` is what keeps the canvas readable: the covers come from
 * `i.ytimg.com`, which answers with `Access-Control-Allow-Origin: *`, so the
 * pixels can be inspected.  Anything that goes wrong — a host without CORS, a
 * `429`, a canvas the browser refuses — resolves to `null` and the selected
 * accent simply stays in place.
 */
export function extractAccent(url: string | null): Promise<string | null> {
  if (!url) return Promise.resolve(null);

  const remembered = cache.get(url);
  if (remembered) return remembered;

  const answer = readCover(url);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(url, answer);
  answer.then((color) => {
    // a miss stays a miss only until the next try — never cache a failure
    if (!color) cache.delete(url);
  });

  return answer;
}

/**
 * Load `url`, crop it to its 1:1 centre and hand the samples to
 * {@link pickAccentColor}.
 *
 * Only the **1:1** of the thumbnail is read — the same square `object-fit:
 * cover` paints in every list and in the player.  A widescreen video frame
 * brings its set, its letterboxing and its title card along, and none of that
 * is what the record looks like.
 */
function readCover(url: string): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => {
      try {
        const side = Math.min(image.naturalWidth, image.naturalHeight);
        if (!side) {
          finish(null);
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) {
          finish(null);
          return;
        }
        context.drawImage(
          image,
          (image.naturalWidth - side) / 2,
          (image.naturalHeight - side) / 2,
          side,
          side,
          0,
          0,
          SAMPLE_SIZE,
          SAMPLE_SIZE,
        );
        finish(pickAccentColor(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data));
      } catch {
        finish(null); // tainted canvas, or no 2d context at all
      }
    };
    image.onerror = () => finish(null);
    image.src = url;
  });
}

/**
 * Push the cover colour of *track* into the theme while adaptive is on.
 *
 * `ThemeProvider` sits **above** `PlayerProvider` in the tree, so the theme
 * cannot reach up for the player — this hook runs the other way round: it
 * reads the switch from the theme and hands the extracted colour back.
 *
 * The switch it reads is the *effective* one: ThemeContext reports adaptive
 * as off while high performance mode is on, so no cover is sampled then and
 * the colour read for the last track is dropped instead.
 *
 * @param track normalized track (the one playing, if any)
 */
export function useAdaptiveAccent(track: Track | null): void {
  const { adaptiveAccent, setAdaptiveColor } = useTheme();
  const videoId = track?.videoId || null;
  const artwork = track?.artwork || null;

  useEffect(() => {
    if (!adaptiveAccent || !videoId) {
      // off, or nothing playing: the chosen accent is in charge again
      setAdaptiveColor(null);
      return undefined;
    }

    let cancelled = false;
    extractAccent(artwork || cdnArtwork(videoId)).then((color) => {
      // a slow answer for a song that is no longer playing must not win
      if (!cancelled) setAdaptiveColor(color);
    });
    return () => {
      cancelled = true;
    };
  }, [adaptiveAccent, videoId, artwork, setAdaptiveColor]);
}
