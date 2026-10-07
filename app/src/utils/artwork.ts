/**
 * Pure artwork URL-choosing logic, ported from
 * frontend/src/utils/artwork.js and frontend/src/utils/track.js.
 *
 * Only the URL half is ported: React Native's `Image` handles caching and
 * painting, so the throttled byte queue, Cache Storage store, object URLs
 * and canvas colour extraction of the web app have no equivalent here and
 * are skipped entirely.
 */

/** Sizes the i.ytimg CDN exposes for a video, largest first. */
export const YTIMG_SIZES = ['maxresdefault', 'hq720', 'sddefault', 'hqdefault'];
// the WebP twin (`vi_webp/…webp`) is matched so it still gets a fallback,
// but it is never produced again: some environments fail to paint WebP
const YTIMG_RE =
  /^https:\/\/i\.ytimg\.com\/(?:vi_webp|vi)\/([\w-]{11})\/([\w-]+)\.(?:webp|jpg|png)$/;

const YTIMG = 'https://i.ytimg.com';

/**
 * Largest artwork of a song, taken from the ``i.ytimg.com`` CDN.
 *
 * All the song lists — related, queue, suggestions, search — render this URL
 * instead of the ``yt3.googleusercontent.com`` cover YouTube Music hands out,
 * because that host answers bursts of artwork requests with ``429``.
 *
 * Always **JPEG**: the CDN also exposes a ``vi_webp/…webp`` twin that some
 * environments refuse to paint, so it is never used — display or download.
 */
export function cdnArtwork(videoId: string | null | undefined): string | null {
  return typeof videoId === 'string' && videoId
    ? `${YTIMG}/vi/${videoId}/maxresdefault.jpg`
    : null;
}

/** Rough pixel count; unknown dimensions fall back to the longest side. */
function area(thumb: Thumbnail | null | undefined): number {
  const width = thumb?.width || 0;
  const height = thumb?.height || 0;
  return width * height || thumb?.width || thumb?.height || 0;
}

/** WebP never renders reliably in an `<img>` — always prefer JPEG. */
function isWebp(url: string): boolean {
  return /\.webp([?#]|$)/i.test(url);
}

interface Thumbnail {
  url?: string;
  width?: number;
  height?: number;
}

/**
 * Smaller alternatives of an i.ytimg artwork, largest first, **JPEG only**.
 *
 * `maxresdefault` does not exist for every upload, so a tile that fails to
 * paint walks down this list (`maxresdefault.jpg` → `hq720.jpg` → …)
 * instead of leaving an empty box behind.
 *
 * @param url artwork URL
 * @returns candidate URLs, never containing *url* itself
 */
export function artworkFallbacks(url: string): string[] {
  const match = YTIMG_RE.exec(url || '');
  if (!match) return [];
  const videoId = match[1];
  const size = match[2];
  const start = YTIMG_SIZES.indexOf(size);
  const out: string[] = [];
  for (const candidate of YTIMG_SIZES.slice(start < 0 ? 0 : start)) {
    out.push(`https://i.ytimg.com/vi/${videoId}/${candidate}.jpg`);
  }
  return [...new Set(out)].filter((candidate) => candidate !== url);
}

/**
 * Pick the largest usable thumbnail URL out of any supported shape.
 *
 * The backend returns every available size of an artwork sorted smallest
 * first — the biggest one is always the **last** entry — and sorts by pixel
 * area so a square 1280×1280 cover beats a 1280×720 video frame.  Plain
 * strings are taken as-is (already resolved URLs).
 *
 * A `.webp` answer is only ever used as a last resort: whatever else is in
 * the payload wins first, so the app never paints (or fails to paint) a WebP
 * when a JPEG of the same cover exists.
 */
export function pickArtwork(...candidates: unknown[]): string | null {
  let webpFallback: string | null = null;
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate === 'string' && /^https?:/.test(candidate)) {
      if (isWebp(candidate)) {
        if (!webpFallback) webpFallback = candidate;
      } else {
        return candidate;
      }
      continue;
    }
    const list = Array.isArray(candidate)
      ? (candidate as Thumbnail[])
      : (candidate as { thumbnails?: Thumbnail[] } | null | undefined)?.thumbnails;
    if (Array.isArray(list) && list.length) {
      const sorted = [...list]
        .filter((thumb) => thumb?.url)
        .sort((a, b) => area(b) - area(a));
      const jpeg = sorted.find((thumb) => !isWebp(thumb.url as string));
      if (jpeg) return jpeg.url as string;
      if (!webpFallback && sorted.length) webpFallback = sorted[0].url ?? null;
    }
  }
  return webpFallback;
}
