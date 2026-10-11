import type { Artist, RawTrack, Thumbnail, Track } from '../types/models';
import { parseDuration } from './format';

/**
 * The API returns several slightly different track shapes (search results,
 * watch queue, playlists, related panel). The UI always works with the
 * normalized shape produced here.
 */

const YTIMG = 'https://i.ytimg.com';

/**
 * Largest artwork of a song, taken from the `i.ytimg.com` CDN.
 *
 * Always **JPEG**: the CDN also exposes a `vi_webp/…webp` twin that some
 * browsers refuse to paint, so it is never used — display or download.
 */
export function cdnArtwork(videoId: string | null | undefined): string | null {
  return typeof videoId === 'string' && videoId ? `${YTIMG}/vi/${videoId}/maxresdefault.jpg` : null;
}

function area(thumb: Thumbnail): number {
  const width = thumb?.width || 0;
  const height = thumb?.height || 0;
  return width * height || thumb?.width || thumb?.height || 0;
}

/** WebP never renders reliably in an `<img>` — always prefer JPEG. */
function isWebp(url: string): boolean {
  return /\.webp([?#]|$)/i.test(url);
}

type ArtworkCandidate =
  | string
  | null
  | undefined
  | { thumbnails?: Thumbnail[]; url?: string };

/**
 * Pick the largest usable thumbnail URL out of any supported shape.
 *
 * A `.webp` answer is only ever used as a last resort: whatever else is in
 * the payload wins first.
 */
export function pickArtwork(...candidates: ArtworkCandidate[]): string | null {
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
      : (candidate as { thumbnails?: Thumbnail[] }).thumbnails;
    if (Array.isArray(list) && list.length) {
      const sorted = [...list]
        .filter((thumb) => Boolean(thumb?.url))
        .sort((a, b) => area(b) - area(a));
      const jpeg = sorted.find((thumb) => !isWebp(thumb.url));
      if (jpeg) return jpeg.url;
      if (!webpFallback && sorted.length) webpFallback = sorted[0].url;
    }
  }
  return webpFallback;
}

/**
 * Artwork for any item the API can return: songs go through the i.ytimg CDN,
 * albums / playlists keep their own square cover.
 */
export function primaryArtwork(item: unknown): string | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  return (
    (typeof record.videoId === 'string' &&
      record.videoId &&
      cdnArtwork(record.videoId)) ||
    pickArtwork(
      record.artwork as ArtworkCandidate,
      record.thumbnail as ArtworkCandidate,
      record.thumbnails as ArtworkCandidate,
    )
  );
}

/** "Artists array" | "album string" | "album object" -> display strings. */
export function artistNames(artists: unknown): string {
  if (!artists) return '';
  if (typeof artists === 'string') return artists;
  if (Array.isArray(artists)) {
    return artists
      .map((artist: Artist) => (typeof artist === 'string' ? artist : artist?.name))
      .filter(Boolean)
      .join(', ');
  }
  if (typeof artists === 'object' && artists !== null && 'name' in artists) {
    return String((artists as { name?: string }).name || '');
  }
  return '';
}

export function albumName(album: unknown): string {
  if (!album) return '';
  if (typeof album === 'string') return album;
  if (typeof album === 'object' && 'name' in album) {
    return String((album as { name?: string }).name || '');
  }
  return '';
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/** Normalize any raw API track object. Returns null when unusable. */
export function normalizeTrack(raw: unknown): Track | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as RawTrack;
  const videoId = record.videoId;
  if (!videoId || typeof videoId !== 'string') return null;

  const durationSeconds =
    typeof record.duration_seconds === 'number'
      ? record.duration_seconds
      : parseDuration(record.duration ?? record.length ?? record.lengthSeconds);

  const artists = Array.isArray(record.artists) ? (record.artists as Artist[]) : [];

  return {
    videoId,
    title: typeof record.title === 'string' && record.title ? record.title : 'Unknown title',
    artists,
    // The API is inconsistent about where the artist lives: `artists[]` on
    // songs, a plain `artist` string on artist results, nothing at all on a
    // few bare "Song • 3:32" search rows.
    artist:
      artistNames(record.artists) ||
      (typeof record.artist === 'string' ? record.artist : '') ||
      'Unknown artist',
    album:
      typeof record.album === 'string'
        ? { name: record.album, id: null }
        : ((record.album as Track['album']) ?? null),
    albumName: albumName(record.album),
    duration: typeof record.duration === 'string' ? record.duration : null,
    durationSeconds,
    // `artwork` is accepted as well so re-normalizing an already normalized
    // track never loses the cover; songs always resolve to the i.ytimg CDN.
    artwork: primaryArtwork(raw),
    year: firstString(record.year),
    releaseDate: firstString(record.releaseDate, record.release_date),
    isExplicit: Boolean(record.isExplicit),
    playlistId: firstString(record.playlistId),
  };
}

export function normalizeList(items: unknown): Track[] {
  if (!Array.isArray(items)) return [];
  return items.map(normalizeTrack).filter((track): track is Track => track !== null);
}
