/**
 * `tracks` — the canonical metadata for every song the app knows about
 * (downloaded, favorited or inside a playlist).
 *
 * Tracks are written *before* any favorite/playlist/download row references
 * them, which keeps the foreign keys happy without needing deferred inserts.
 */
import type { Track } from '../../types/models';
import {
  deleteTrackRecord,
  getTrackRecord,
  putTrackRecord,
} from '../../services/storage';
import { getDb } from '../connection';
import { usingFallback } from './fallback';
import { mapTrackRow, trackBindValues, UPSERT_TRACK_SQL, type TrackRow } from './rows';

export type SortKey = 'title' | 'releaseDate' | 'artist';
export type SortDir = 'asc' | 'desc';

/** Maps a UI sort choice onto an ORDER BY expression. */
export function orderBy(key: SortKey, dir: SortDir): string {
  const column =
    key === 'title'
      ? 'title COLLATE NOCASE'
      : key === 'artist'
        ? 'artist COLLATE NOCASE'
        : 'COALESCE(release_date, year)';
  return `${column} ${dir === 'desc' ? 'DESC' : 'ASC'}, title COLLATE NOCASE ASC`;
}

export async function upsertTrack(track: Track & { releaseDate?: string | null }): Promise<void> {
  if (usingFallback) {
    await putTrackRecord(track);
    return;
  }
  const db = await getDb();
  await db.execute(UPSERT_TRACK_SQL, trackBindValues(track));
}

/** Inserts a minimal row so a song can join a playlist before it is known. */
export async function ensureTrack(videoId: string, title: string, artist: string): Promise<void> {
  if (usingFallback) {
    if (await getTrackRecord(videoId)) return;
    await putTrackRecord({
      videoId,
      title,
      artists: artist ? [artist] : [],
      artist,
      album: null,
      albumName: '',
      duration: null,
      durationSeconds: null,
      artwork: null,
      year: null,
      releaseDate: null,
      isExplicit: false,
      playlistId: null,
    });
    return;
  }
  const db = await getDb();
  await db.execute(
    `INSERT INTO tracks (video_id, title, artist, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(video_id) DO NOTHING`,
    [videoId, title, artist, Date.now()],
  );
}

export async function getTrack(videoId: string): Promise<Track | null> {
  if (usingFallback) return getTrackRecord(videoId);
  const db = await getDb();
  const rows = await db.select<TrackRow[]>(
    'SELECT * FROM tracks WHERE video_id = $1',
    [videoId],
  );
  return rows[0] ? mapTrackRow(rows[0]) : null;
}

export async function deleteTrack(videoId: string): Promise<void> {
  if (usingFallback) {
    await deleteTrackRecord(videoId);
    return;
  }
  const db = await getDb();
  await db.execute('DELETE FROM tracks WHERE video_id = $1', [videoId]);
}
