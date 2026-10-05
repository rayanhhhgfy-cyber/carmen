import { parseDuration } from './format';

/**
 * The API returns several slightly different track shapes (search results,
 * watch queue, playlists, related panel).  The UI always works with the
 * normalized shape produced here.
 */

/**
 * Pick the largest usable thumbnail URL out of any supported shape.
 *
 * The backend returns every available size of an artwork sorted smallest
 * first — YouTube always appends the biggest one last — so the largest
 * entry wins here.  Plain strings are taken as-is (already resolved URLs).
 */
export function pickArtwork(...candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate === 'string' && /^https?:/.test(candidate)) return candidate;
    const list = Array.isArray(candidate) ? candidate : candidate.thumbnails;
    if (Array.isArray(list) && list.length) {
      const sorted = [...list].sort(
        (a, b) => (b.width || b.height || 0) - (a.width || a.height || 0),
      );
      const url = sorted[0]?.url;
      if (url) return url;
    }
  }
  return null;
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
    // track (what the home library persists) never loses the cover.
    artwork: pickArtwork(raw.artwork, raw.thumbnail, raw.thumbnails),
    year: raw.year || null,
    isExplicit: Boolean(raw.isExplicit),
    playlistId: raw.playlistId || null,
  };
}

export function normalizeList(items) {
  if (!Array.isArray(items)) return [];
  return items.map(normalizeTrack).filter(Boolean);
}
