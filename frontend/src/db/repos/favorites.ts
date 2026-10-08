/**
 * `favorites` — the set of favorited tracks, keyed by `video_id`.
 *
 * Favoriting a song that the database has never seen also upserts its
 * metadata, so the favorites list stays fully readable offline.
 */
import type { PlaylistSong, Track } from '../../types/models';
import { getDb } from '../connection';
import { fallbackGet, fallbackSet, usingFallback } from './fallback';
import { mapSongRow, trackBindValues, UPSERT_TRACK_SQL, type SongRow } from './rows';

const FAVORITE_SELECT = `
  SELECT t.*, d.audio_path,
         1 AS is_favorite
  FROM favorites f
  JOIN tracks t ON t.video_id = f.video_id
  LEFT JOIN downloads d ON d.video_id = t.video_id
`;

export async function isFavorite(videoId: string): Promise<boolean> {
  if (usingFallback) {
    return fallbackGet<string[]>('favoriteIds', []).includes(videoId);
  }
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    'SELECT COUNT(*) AS n FROM favorites WHERE video_id = $1',
    [videoId],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

/** Toggles and returns the **new** state. */
export async function toggleFavorite(track: Track): Promise<boolean> {
  const videoId = track.videoId;
  if (usingFallback) {
    const current = new Set(fallbackGet<string[]>('favoriteIds', []));
    const next = !current.has(videoId);
    if (next) current.add(videoId);
    else current.delete(videoId);
    fallbackSet('favoriteIds', [...current]);
    return next;
  }

  const db = await getDb();
  const exists = await isFavorite(videoId);
  if (exists) {
    await db.execute('DELETE FROM favorites WHERE video_id = $1', [videoId]);
    return false;
  }
  await db.execute(UPSERT_TRACK_SQL, trackBindValues(track));
  await db.execute(
    'INSERT INTO favorites (video_id, created_at) VALUES ($1, $2)',
    [videoId, Date.now()],
  );
  return true;
}

/** Favorited songs as a playlist-like list (works offline). */
export async function listFavorites(): Promise<PlaylistSong[]> {
  if (usingFallback) {
    const ids = fallbackGet<string[]>('favoriteIds', []);
    return ids.map(
      (videoId): PlaylistSong => ({
        videoId,
        title: videoId,
        artists: [],
        artist: '',
        album: null,
        albumName: '',
        duration: null,
        durationSeconds: null,
        artwork: null,
        year: null,
        releaseDate: null,
        isExplicit: false,
        playlistId: null,
        isFavorite: true,
        isDownloaded: false,
        audioPath: null,
      }),
    );
  }
  const db = await getDb();
  const rows = await db.select<SongRow[]>(
    `${FAVORITE_SELECT} ORDER BY f.created_at DESC`,
  );
  return rows.map(mapSongRow);
}

export async function favoriteIds(): Promise<string[]> {
  if (usingFallback) return fallbackGet<string[]>('favoriteIds', []);
  const db = await getDb();
  const rows = await db.select<{ video_id: string }[]>(
    'SELECT video_id FROM favorites',
  );
  return rows.map((row) => row.video_id);
}
