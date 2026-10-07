import { parseDuration } from './format';
import { cdnArtwork, pickArtwork } from './artwork';
import type { Artist, Track } from '../types';

/**
 * The API returns several slightly different track shapes (search results,
 * watch queue, playlists, related panel).  The UI always works with the
 * normalized shape produced here.
 *
 * Port of frontend/src/utils/track.js; the URL-choosing helpers
 * (`cdnArtwork`, `pickArtwork`) live in ./artwork and are re-exported here
 * just as the web module exports them.
 */

// `cdnArtwork` and `pickArtwork` are defined in ./artwork (the URL-choosing
// logic) but exported from this module like the original track.js.
export { cdnArtwork, pickArtwork };

/** "Artists array" | "album string" | "album object" -> display strings. */
export function artistNames(artists: unknown): string {
  if (!artists) return '';
  if (typeof artists === 'string') return artists;
  if (Array.isArray(artists)) {
    return artists
      .map((artist): string | undefined =>
        typeof artist === 'string' ? artist : (artist as Artist)?.name,
      )
      .filter((name): name is string => Boolean(name))
      .join(', ');
  }
  return (artists as { name?: string }).name || '';
}

export function albumName(album: unknown): string {
  if (!album) return '';
  if (typeof album === 'string') return album;
  return (album as { name?: string }).name || '';
}

/**
 * Artwork for any item the API can return: songs go through the i.ytimg CDN
 * (see {@link cdnArtwork}), albums / playlists keep their own square cover.
 */
export function primaryArtwork(item: unknown): string | null {
  if (!item || typeof item !== 'object') return null;
  const source = item as {
    videoId?: unknown;
    artwork?: unknown;
    thumbnail?: unknown;
    thumbnails?: unknown;
  };
  return (
    (typeof source.videoId === 'string' && source.videoId && cdnArtwork(source.videoId)) ||
    pickArtwork(source.artwork, source.thumbnail, source.thumbnails)
  );
}

/** Normalize any raw API track object. Returns null when unusable. */
export function normalizeTrack(raw: unknown): Track | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const videoId = source.videoId;
  if (!videoId || typeof videoId !== 'string') return null;

  const rawDuration = source.duration || source.length || source.lengthSeconds;
  const durationSeconds =
    typeof source.duration_seconds === 'number'
      ? source.duration_seconds
      : typeof rawDuration === 'string' || typeof rawDuration === 'number'
        ? parseDuration(rawDuration)
        : null;

  return {
    videoId,
    title: (source.title as string) || 'Unknown title',
    artists: Array.isArray(source.artists) ? (source.artists as Artist[]) : [],
    artist: artistNames(source.artists) || 'Unknown artist',
    album:
      typeof source.album === 'string'
        ? { name: source.album, id: null }
        : ((source.album || null) as Track['album']),
    albumName: albumName(source.album),
    duration: (source.duration || source.length || null) as string | null,
    durationSeconds,
    // `artwork` is accepted as well so re-normalizing an already normalized
    // track (what the home library persists) never loses the cover; songs
    // always resolve to the i.ytimg CDN artwork.
    artwork: primaryArtwork(raw),
    year: (source.year as string) || null,
    isExplicit: Boolean(source.isExplicit),
    playlistId: (source.playlistId as string) || null,
  };
}

export function normalizeList(items: unknown): Track[] {
  if (!Array.isArray(items)) return [];
  return items.map(normalizeTrack).filter((track): track is Track => track !== null);
}
