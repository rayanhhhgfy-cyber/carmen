import { parseDuration } from './format';

/**
 * The API returns several slightly different track shapes (search results,
 * watch queue, playlists, related panel).  The UI always works with the
 * normalized shape produced here.
 */

const YTIMG = 'https://i.ytimg.com';

/**
 * Largest artwork of a song, taken from the ``i.ytimg.com`` CDN.
 *
 * All the song lists — related, queue, suggestions, search — render this URL
 * instead of the ``yt3.googleusercontent.com`` cover YouTube Music hands out,
 * because that host answers bursts of artwork requests with ``429``.
 *
 * Always **JPEG**: the CDN also exposes a ``vi_webp/…webp`` twin that some
 * browsers refuse to paint, so it is never used — display or download.
 */
export function cdnArtwork(videoId) {
  return typeof videoId === 'string' && videoId
    ? `${YTIMG}/vi/${videoId}/maxresdefault.jpg`
    : null;
}

/** Rough pixel count; unknown dimensions fall back to the longest side. */
function area(thumb) {
  const width = thumb?.width || 0;
  const height = thumb?.height || 0;
  return width * height || thumb?.width || thumb?.height || 0;
}

/** WebP never renders reliably in an `<img>` — always prefer JPEG. */
function isWebp(url) {
  return typeof url === 'string' && /\.webp([?#]|$)/i.test(url);
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
export function pickArtwork(...candidates) {
  let webpFallback = null;
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
    const list = Array.isArray(candidate) ? candidate : candidate.thumbnails;
    if (Array.isArray(list) && list.length) {
      const sorted = [...list]
        .filter((thumb) => thumb?.url)
        .sort((a, b) => area(b) - area(a));
      const jpeg = sorted.find((thumb) => !isWebp(thumb.url));
      if (jpeg) return jpeg.url;
      if (!webpFallback && sorted.length) webpFallback = sorted[0].url;
    }
  }
  return webpFallback;
}

/**
 * Artwork for any item the API can return: songs go through the i.ytimg CDN
 * (see {@link cdnArtwork}), albums / playlists keep their own square cover.
 */
export function primaryArtwork(item) {
  if (!item || typeof item !== 'object') return null;
  return (
    (typeof item.videoId === 'string' && item.videoId && cdnArtwork(item.videoId)) ||
    pickArtwork(item.artwork, item.thumbnail, item.thumbnails)
  );
}

/** "Artists array" | "album string" | "album object" -> display strings. */
export function artistNames(artists) {
  if (!artists) return '';
  if (typeof artists === 'string') return artists;
  if (Array.isArray(artists)) {
    return artists
      .map((artist) => (typeof artist === 'string' ? artist : artist?.name))
      .filter(Boolean)
      .join(', ');
  }
  return artists.name || '';
}

export function albumName(album) {
  if (!album) return '';
  if (typeof album === 'string') return album;
  return album.name || '';
}

/** Normalize any raw API track object. Returns null when unusable. */
export function normalizeTrack(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const videoId = raw.videoId;
  if (!videoId || typeof videoId !== 'string') return null;

  const durationSeconds =
    typeof raw.duration_seconds === 'number'
      ? raw.duration_seconds
      : parseDuration(raw.duration || raw.length || raw.lengthSeconds);

  return {
    videoId,
    title: raw.title || 'Unknown title',
    artists: Array.isArray(raw.artists) ? raw.artists : [],
    artist: artistNames(raw.artists) || 'Unknown artist',
    album: typeof raw.album === 'string' ? { name: raw.album, id: null } : raw.album || null,
    albumName: albumName(raw.album),
    duration: raw.duration || raw.length || null,
    durationSeconds,
    // `artwork` is accepted as well so re-normalizing an already normalized
    // track (what the home library persists) never loses the cover; songs
    // always resolve to the i.ytimg CDN artwork.
    artwork: primaryArtwork(raw),
    year: raw.year || null,
    isExplicit: Boolean(raw.isExplicit),
    playlistId: raw.playlistId || null,
  };
}

export function normalizeList(items) {
  if (!Array.isArray(items)) return [];
  return items.map(normalizeTrack).filter(Boolean);
}
