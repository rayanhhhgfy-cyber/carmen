/**
 * Row ↔ domain mappers.
 *
 * SQL rows are snake_case, the app speaks camelCase; every conversion happens
 * here so the repositories and the UI stay free of column names.
 */
import type { DownloadedSong, PlaylistSong, Track } from '../../types/models';
import { fromBool, toBool } from '../connection';

export interface TrackRow {
  video_id: string;
  title: string;
  artist: string;
  artists_json: string;
  album: string;
  album_id: string | null;
  duration_seconds: number | null;
  artwork: string | null;
  year: string | null;
  release_date: string | null;
  is_explicit: number;
}

export interface SongRow extends TrackRow {
  audio_path?: string | null;
  artwork_path?: string | null;
  lyrics_path?: string | null;
  lyrics_synced?: number | null;
  bytes?: number | null;
  downloaded_at?: number | null;
  is_favorite?: number | null;
  playlist_id?: number;
  position?: number;
}

function parseArtists(json: string | null | undefined, fallbackArtist: string): Track['artists'] {
  if (!json) return fallbackArtist ? [fallbackArtist] : [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (Array.isArray(parsed)) return parsed as Track['artists'];
  } catch {
    /* corrupted row — fall through */
  }
  return fallbackArtist ? [fallbackArtist] : [];
}

function parseAlbum(
  name: string | null | undefined,
  id: string | null | undefined,
): Track['album'] {
  if (!name && !id) return null;
  return { name: name || '', id: id || null };
}

export function mapTrackRow(row: TrackRow): Track {
  return {
    videoId: row.video_id,
    title: row.title,
    artists: parseArtists(row.artists_json, row.artist),
    artist: row.artist,
    album: parseAlbum(row.album, row.album_id),
    albumName: row.album || '',
    duration: row.duration_seconds ? String(row.duration_seconds) : null,
    durationSeconds: row.duration_seconds,
    artwork: row.artwork,
    year: row.year,
    releaseDate: row.release_date,
    isExplicit: toBool(row.is_explicit),
    playlistId: null,
  };
}

export function mapSongRow<T extends SongRow>(row: T): PlaylistSong {
  return {
    ...mapTrackRow(row),
    isFavorite: toBool(row.is_favorite),
    isDownloaded: Boolean(row.audio_path),
    audioPath: row.audio_path || null,
  };
}

export function mapDownloadedRow(row: SongRow): DownloadedSong {
  return {
    ...mapTrackRow(row),
    audioPath: row.audio_path || '',
    artworkPath: row.artwork_path || null,
    lyricsPath: row.lyrics_path || null,
    lyricsSynced: toBool(row.lyrics_synced),
    bytes: row.bytes ?? null,
    downloadedAt: row.downloaded_at ?? 0,
    isFavorite: toBool(row.is_favorite),
  };
}

/** Values in the exact order of the `tracks` INSERT placeholder list. */
export function trackBindValues(track: Track & { releaseDate?: string | null }): unknown[] {
  return [
    track.videoId,
    track.title,
    track.artist,
    JSON.stringify(track.artists ?? []),
    track.albumName || '',
    track.album?.id ?? null,
    track.durationSeconds ?? null,
    track.artwork ?? null,
    track.year ?? null,
    track.releaseDate ?? track.year ?? null,
    fromBool(track.isExplicit),
    Date.now(),
  ];
}

export const UPSERT_TRACK_SQL = `
  INSERT INTO tracks (
    video_id, title, artist, artists_json, album, album_id, duration_seconds,
    artwork, year, release_date, is_explicit, updated_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  ON CONFLICT(video_id) DO UPDATE SET
    title = excluded.title,
    artist = excluded.artist,
    artists_json = excluded.artists_json,
    album = excluded.album,
    album_id = excluded.album_id,
    duration_seconds = excluded.duration_seconds,
    artwork = excluded.artwork,
    year = excluded.year,
    release_date = excluded.release_date,
    is_explicit = excluded.is_explicit,
    updated_at = excluded.updated_at
`;
