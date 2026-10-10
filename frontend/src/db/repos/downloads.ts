/**
 * `downloads` — the offline catalogue: which songs live on disk, where their
 * audio / artwork / `track.json` files are, and when they were downloaded.
 *
 * Only raw, unconverted files are recorded (see `offline/downloads.ts`).
 */
import type { DownloadedSong, Track } from '../../types/models';
import {
  allDownloadRecords as allDownloadRows,
  deleteDownloadRecord,
  getDownloadRecord,
  putDownloadRecord,
  putTrackRecord,
  type DownloadRow,
} from '../../services/storage';
import { getDb } from '../connection';
import { usingFallback } from './fallback';
import { favoriteIds } from './favorites';
import { mapDownloadedRow, trackBindValues, UPSERT_TRACK_SQL, type SongRow } from './rows';
import { orderBy, type SortDir, type SortKey } from './tracks';

export interface NewDownload {
  track: Track & { releaseDate?: string | null };
  audioPath: string;
  artworkPath: string | null;
  lyricsPath: string | null;
  lyricsSynced: boolean;
  bytes: number | null;
}

export interface DownloadRecord {
  videoId: string;
  audioPath: string;
  artworkPath: string | null;
  lyricsPath: string | null;
  lyricsSynced: boolean;
  downloadedAt: number;
}

export interface SongQuery {
  sort?: SortKey;
  dir?: SortDir;
  favoritesOnly?: boolean;
}

const SONG_SELECT = `
  SELECT t.*, d.audio_path, d.artwork_path, d.lyrics_path, d.lyrics_synced,
         d.bytes, d.downloaded_at,
         (f.video_id IS NOT NULL) AS is_favorite
  FROM downloads d
  JOIN tracks t   ON t.video_id = d.video_id
  LEFT JOIN favorites f ON f.video_id = t.video_id
`;

// ── Browser branch (IndexedDB, see services/storage) ─────────────────────────

function toDownloadedSong(row: DownloadRow, isFavorite: boolean): DownloadedSong {
  return {
    ...row.track,
    audioPath: row.audioPath,
    artworkPath: row.artworkPath,
    lyricsPath: row.lyricsPath,
    lyricsSynced: row.lyricsSynced,
    bytes: row.bytes,
    downloadedAt: row.downloadedAt,
    isFavorite,
  };
}

/** JS twin of `orderBy`'s `ORDER BY` — NOCASE primary, title tiebreak. */
function sortDownloaded(
  songs: DownloadedSong[],
  sort: SortKey,
  dir: SortDir,
): DownloadedSong[] {
  const sign = dir === 'desc' ? -1 : 1;
  const primary = (song: DownloadedSong): string =>
    sort === 'artist'
      ? song.artist
      : sort === 'releaseDate'
        ? (song.releaseDate || song.year || '')
        : song.title;
  return songs.sort(
    (a, b) =>
      sign * primary(a).localeCompare(primary(b), undefined, { sensitivity: 'base' }) ||
      a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
  );
}

/** Every download as `DownloadedSong`, favorites flag included. */
async function browserSongs(): Promise<DownloadedSong[]> {
  const [rows, favorites] = await Promise.all([
    allDownloadRows(),
    favoriteIds().catch(() => [] as string[]),
  ]);
  const favoriteSet = new Set(favorites);
  return rows.map((row) => toDownloadedSong(row, favoriteSet.has(row.videoId)));
}

/** Records a finished download (metadata first, then the file locations). */
export async function insertDownload(entry: NewDownload): Promise<void> {
  if (usingFallback) {
    await putTrackRecord(entry.track);
    await putDownloadRecord({
      videoId: entry.track.videoId,
      track: entry.track,
      audioPath: entry.audioPath,
      artworkPath: entry.artworkPath,
      lyricsPath: entry.lyricsPath,
      lyricsSynced: entry.lyricsSynced,
      bytes: entry.bytes,
      downloadedAt: Date.now(),
    });
    return;
  }
  const db = await getDb();
  await db.execute(UPSERT_TRACK_SQL, trackBindValues(entry.track));
  await db.execute(
    `INSERT INTO downloads
       (video_id, audio_path, artwork_path, lyrics_path, lyrics_synced, bytes, downloaded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(video_id) DO UPDATE SET
       audio_path = excluded.audio_path,
       artwork_path = excluded.artwork_path,
       lyrics_path = excluded.lyrics_path,
       lyrics_synced = excluded.lyrics_synced,
       bytes = excluded.bytes,
       downloaded_at = excluded.downloaded_at`,
    [
      entry.track.videoId,
      entry.audioPath,
      entry.artworkPath,
      entry.lyricsPath,
      entry.lyricsSynced ? 1 : 0,
      entry.bytes,
      Date.now(),
    ],
  );
}

/** All downloaded songs with sorting + the favorites quick filter. */
export async function listDownloads(query: SongQuery = {}): Promise<DownloadedSong[]> {
  if (usingFallback) {
    const songs = await browserSongs();
    const filtered = query.favoritesOnly ? songs.filter((song) => song.isFavorite) : songs;
    return sortDownloaded(filtered, query.sort ?? 'title', query.dir ?? 'asc');
  }
  const db = await getDb();
  const where = query.favoritesOnly ? 'WHERE f.video_id IS NOT NULL' : '';
  const sql = `${SONG_SELECT} ${where} ORDER BY ${orderBy(query.sort ?? 'title', query.dir ?? 'asc')}`;
  const rows = await db.select<SongRow[]>(sql);
  return rows.map(mapDownloadedRow);
}

/** The last `limit` downloads — the "Recently Downloaded" carousel. */
export async function recentDownloads(limit = 10): Promise<DownloadedSong[]> {
  if (usingFallback) {
    const songs = await browserSongs();
    return songs.sort((a, b) => b.downloadedAt - a.downloadedAt).slice(0, limit);
  }
  const db = await getDb();
  const rows = await db.select<SongRow[]>(
    `${SONG_SELECT} ORDER BY d.downloaded_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map(mapDownloadedRow);
}

export async function getDownload(videoId: string): Promise<DownloadRecord | null> {
  if (usingFallback) {
    const row = await getDownloadRecord(videoId);
    if (!row?.audioPath) return null;
    return {
      videoId: row.videoId,
      audioPath: row.audioPath,
      artworkPath: row.artworkPath,
      lyricsPath: row.lyricsPath,
      lyricsSynced: row.lyricsSynced,
      downloadedAt: row.downloadedAt,
    };
  }
  const db = await getDb();
  const rows = await db.select<SongRow[]>(
    `${SONG_SELECT} WHERE t.video_id = $1`,
    [videoId],
  );
  const row = rows[0];
  if (!row || !row.audio_path) return null;
  return {
    videoId,
    audioPath: row.audio_path,
    artworkPath: row.artwork_path || null,
    lyricsPath: row.lyrics_path || null,
    lyricsSynced: row.lyrics_synced === 1,
    downloadedAt: row.downloaded_at ?? 0,
  };
}

export async function deleteDownloadRow(videoId: string): Promise<void> {
  if (usingFallback) {
    await deleteDownloadRecord(videoId);
    return;
  }
  const db = await getDb();
  await db.execute('DELETE FROM downloads WHERE video_id = $1', [videoId]);
}

/** Downloaded video ids — hydrated once at boot for synchronous lookups. */
export async function downloadedIds(): Promise<string[]> {
  if (usingFallback) {
    return (await allDownloadRows()).map((row) => row.videoId);
  }
  const db = await getDb();
  const rows = await db.select<{ video_id: string }[]>(
    'SELECT video_id FROM downloads',
  );
  return rows.map((row) => row.video_id);
}

/** Full file locations of every download (boot hydration for playback). */
export async function allDownloadRecords(): Promise<DownloadRecord[]> {
  if (usingFallback) {
    return (await allDownloadRows())
      .filter((row) => Boolean(row.audioPath))
      .map((row) => ({
        videoId: row.videoId,
        audioPath: row.audioPath,
        artworkPath: row.artworkPath,
        lyricsPath: row.lyricsPath,
        lyricsSynced: row.lyricsSynced,
        downloadedAt: row.downloadedAt,
      }));
  }
  const db = await getDb();
  const rows = await db.select<SongRow[]>(`${SONG_SELECT}`);
  return rows
    .filter((row) => Boolean(row.audio_path))
    .map((row) => ({
      videoId: row.video_id,
      audioPath: row.audio_path || '',
      artworkPath: row.artwork_path || null,
      lyricsPath: row.lyrics_path || null,
      lyricsSynced: row.lyrics_synced === 1,
      downloadedAt: row.downloaded_at ?? 0,
    }));
}
