/**
 * Library backup & restore — the whole local library as one dated JSON
 * file (`carmen-library-YYYY-MM-DD.json`): every playlist with its
 * ordered track metadata, the favorites, and the downloads index.
 *
 * Downloads are backed up as **metadata only** (videoId, date, byte size
 * and the track record): the audio bytes themselves live in the offline
 * store and are far too large to embed in JSON. After a restore, a
 * downloaded song simply re-downloads on demand (or via the playlist's
 * "Download all"), while its place in the library is already back.
 *
 * Restore is explicit and additive: track metadata is upserted, playlists
 * are recreated fresh in the stored order, and favorites are re-added
 * only when they are not already favorites — restoring the same file
 * twice never duplicates a heart (playlists are copies by design, like
 * importing a shared playlist).
 */
import { listDownloads } from '../db/repos/downloads';
import { isFavorite, listFavorites, toggleFavorite } from '../db/repos/favorites';
import {
  addTrackToPlaylist,
  createPlaylist,
  listPlaylistTracks,
  listPlaylists,
  setPlaylistFavorite,
} from '../db/repos/playlists';
import { upsertTrack } from '../db/repos/tracks';
import type { Track } from '../types/models';

export interface LibraryBackupPlaylist {
  name: string;
  description: string | null;
  isFavorite: boolean;
  tracks: Track[];
}

export interface LibraryBackupDownload {
  videoId: string;
  downloadedAt: string | null;
  bytes: number | null;
  track: Track;
}

export interface LibraryBackup {
  app: 'carmen';
  kind: 'library-backup';
  version: 1;
  exportedAt: string;
  playlists: LibraryBackupPlaylist[];
  favorites: Track[];
  downloads: LibraryBackupDownload[];
}

/** The canonical `Track` shape — list flags and file paths stripped. */
function pickTrack(track: Track): Track {
  return {
    videoId: track.videoId,
    title: track.title,
    artists: track.artists,
    artist: track.artist,
    album: track.album,
    albumName: track.albumName,
    duration: track.duration,
    durationSeconds: track.durationSeconds,
    artwork: track.artwork,
    year: track.year,
    releaseDate: track.releaseDate,
    isExplicit: track.isExplicit,
    playlistId: track.playlistId,
  };
}

/* ── build / serialize ────────────────────────────────────────────────── */

/** Snapshot the whole library into a backup document. */
export async function buildLibraryBackup(): Promise<LibraryBackup> {
  const playlists: LibraryBackupPlaylist[] = [];
  for (const playlist of await listPlaylists()) {
    const tracks = await listPlaylistTracks(playlist.id);
    playlists.push({
      name: playlist.name,
      description: playlist.description || null,
      isFavorite: playlist.isFavorite,
      tracks: tracks.map(pickTrack),
    });
  }
  const favorites = (await listFavorites()).map(pickTrack);
  const downloads = (await listDownloads()).map((song) => ({
    videoId: song.videoId,
    downloadedAt: song.downloadedAt ? new Date(song.downloadedAt).toISOString() : null,
    bytes: song.bytes ?? null,
    track: pickTrack(song),
  }));
  return {
    app: 'carmen',
    kind: 'library-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    playlists,
    favorites,
    downloads,
  };
}

export function serializeLibraryBackup(backup: LibraryBackup): string {
  return JSON.stringify(backup, null, 2);
}

/** `carmen-library-YYYY-MM-DD.json` for the given date (local calendar). */
export function backupFileName(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `carmen-library-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

/* ── parse / validate ─────────────────────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function checkedTrack(value: unknown, where: string): Track {
  if (!isRecord(value) || typeof value.videoId !== 'string' || !value.videoId) {
    throw new Error(`That backup is damaged — a track in ${where} is missing its video id.`);
  }
  if (typeof value.title !== 'string') {
    throw new Error(`That backup is damaged — a track in ${where} is missing its title.`);
  }
  return value as unknown as Track;
}

function checkedTrackList(value: unknown, where: string): Track[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`That backup is damaged — ${where} should be a list of tracks.`);
  }
  return value.map((track) => checkedTrack(track, where));
}

/**
 * Parse and validate a backup file's text. Throws an `Error` with a
 * user-readable message for anything that is not a Carmen library
 * backup this build can restore — the caller shows it verbatim.
 */
export function parseLibraryBackup(text: string): LibraryBackup {
  if (!text || !text.trim()) {
    throw new Error('That file is empty — choose a Carmen library backup (.json).');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON — choose a Carmen library backup (.json).');
  }
  if (!isRecord(raw) || raw.app !== 'carmen' || raw.kind !== 'library-backup') {
    throw new Error('That file is not a Carmen library backup.');
  }
  if (raw.version !== 1) {
    throw new Error(
      `That backup uses format version ${String(raw.version ?? '?')}, which this version of Carmen cannot read — update Carmen and try again.`,
    );
  }
  if (typeof raw.exportedAt !== 'string' || !raw.exportedAt) {
    throw new Error('That backup is damaged — it has no export date.');
  }
  if (!Array.isArray(raw.playlists)) {
    throw new Error('That backup is damaged — its playlist list is missing.');
  }
  const playlists: LibraryBackupPlaylist[] = raw.playlists.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.name !== 'string') {
      throw new Error(`That backup is damaged — playlist ${index + 1} is missing its name.`);
    }
    return {
      name: entry.name,
      description: typeof entry.description === 'string' ? entry.description : null,
      isFavorite: Boolean(entry.isFavorite),
      tracks: checkedTrackList(entry.tracks, `playlist “${entry.name}”`),
    };
  });
  const favorites = checkedTrackList(raw.favorites, 'the favorites list');
  const rawDownloads = Array.isArray(raw.downloads) ? raw.downloads : [];
  const downloads: LibraryBackupDownload[] = rawDownloads.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`That backup is damaged — download ${index + 1} is not a record.`);
    }
    const track = checkedTrack(entry.track, 'the downloads index');
    return {
      videoId: typeof entry.videoId === 'string' && entry.videoId ? entry.videoId : track.videoId,
      downloadedAt: typeof entry.downloadedAt === 'string' ? entry.downloadedAt : null,
      bytes: typeof entry.bytes === 'number' ? entry.bytes : null,
      track,
    };
  });
  return {
    app: 'carmen',
    kind: 'library-backup',
    version: 1,
    exportedAt: raw.exportedAt,
    playlists,
    favorites,
    downloads,
  };
}

/* ── restore ──────────────────────────────────────────────────────────── */

/**
 * Restore a parsed backup into the library.
 *
 * Track metadata from every section is upserted first (so playlist and
 * favorite rows always reference known songs), playlists are recreated
 * fresh in the stored order with their favorite flag, and favorites are
 * re-added only when not already favorite. Download entries restore
 * their track metadata only — the audio bytes are not in the file (see
 * the module header), so no download record is recreated.
 *
 * Returns how many playlists were created and how many favorites added.
 */
export async function applyLibraryBackup(
  backup: LibraryBackup,
): Promise<{ playlists: number; favorites: number }> {
  for (const playlist of backup.playlists) {
    for (const track of playlist.tracks) await upsertTrack(track);
  }
  for (const track of backup.favorites) await upsertTrack(track);
  for (const entry of backup.downloads) await upsertTrack(entry.track);

  let playlistsCreated = 0;
  for (const playlist of backup.playlists) {
    const playlistId = await createPlaylist(playlist.name, playlist.description ?? '');
    for (const track of playlist.tracks) {
      await addTrackToPlaylist(playlistId, track);
    }
    if (playlist.isFavorite) await setPlaylistFavorite(playlistId, true);
    playlistsCreated += 1;
  }

  let favoritesAdded = 0;
  for (const track of backup.favorites) {
    if (await isFavorite(track.videoId)) continue;
    await toggleFavorite(track);
    favoritesAdded += 1;
  }

  return { playlists: playlistsCreated, favorites: favoritesAdded };
}
