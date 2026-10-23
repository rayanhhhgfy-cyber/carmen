/**
 * Unit tests for library backup / restore.
 *
 * The round-trip runs through the real repos on the in-memory storage
 * mock (the pattern from `db/repos/playlists.fallback.test`): seed a
 * library, build + serialize a backup, wipe every store, parse + apply,
 * rebuild — playlists and favorites must come back identical.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { memTracks, memKv, memDownloads } = vi.hoisted(() => ({
  memTracks: new Map<string, any>(),
  memKv: new Map<string, unknown>(),
  memDownloads: new Map<string, any>(),
}));

vi.mock('../services/storage', () => ({
  getTrackRecord: async (videoId: string) => memTracks.get(videoId) ?? null,
  putTrackRecord: async (track: any) => {
    memTracks.set(track.videoId, track);
  },
  deleteTrackRecord: async (videoId: string) => {
    memTracks.delete(videoId);
  },
  kvRead: <T>(key: string, fallback: T): T =>
    (memKv.has(key) ? memKv.get(key) : fallback) as T,
  kvWrite: (key: string, value: unknown): void => {
    memKv.set(key, value);
  },
  putDownloadRecord: async (row: any) => {
    memDownloads.set(row.videoId, row);
  },
  getDownloadRecord: async (videoId: string) => memDownloads.get(videoId) ?? null,
  allDownloadRecords: async () => [...memDownloads.values()],
  deleteDownloadRecord: async (videoId: string) => {
    memDownloads.delete(videoId);
  },
}));

import { insertDownload } from '../db/repos/downloads';
import { fallbackSet } from '../db/repos/fallback';
import { toggleFavorite } from '../db/repos/favorites';
import {
  addTrackToPlaylist,
  createPlaylist,
  setPlaylistFavorite,
} from '../db/repos/playlists';
import type { Track } from '../types/models';
import {
  applyLibraryBackup,
  backupFileName,
  buildLibraryBackup,
  parseLibraryBackup,
  serializeLibraryBackup,
  type LibraryBackup,
} from './libraryBackup';

function track(videoId: string, title: string, artist = 'Artist'): Track {
  return {
    videoId,
    title,
    artists: [artist],
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
  };
}

function wipeStores() {
  memTracks.clear();
  memKv.clear();
  memDownloads.clear();
  fallbackSet('playlists', []);
  fallbackSet('favoriteIds', []);
}

beforeEach(() => {
  wipeStores();
});

async function seedLibrary() {
  const mixId = await createPlaylist('Road Mix', 'For the drive');
  await addTrackToPlaylist(mixId, track('v1', 'One'));
  await addTrackToPlaylist(mixId, track('v2', 'Two', 'Duo'));
  const chillId = await createPlaylist('Chill', '');
  await addTrackToPlaylist(chillId, track('v3', 'Three'));
  await setPlaylistFavorite(chillId, true);

  await toggleFavorite(track('v2', 'Two', 'Duo'));
  await toggleFavorite(track('v9', 'Nine', 'Solo'));

  await insertDownload({
    track: track('v1', 'One'),
    audioPath: 'songs/v1/audio.m4a',
    artworkPath: null,
    lyricsPath: null,
    lyricsSynced: false,
    bytes: 12345,
  });
}

/** Playlists compared by name: recreation order is a storage detail. */
function byName(playlists: LibraryBackup['playlists']) {
  return [...playlists].sort((a, b) => a.name.localeCompare(b.name));
}

describe('library backup round-trip', () => {
  it('restores playlists and favorites losslessly on an empty library', async () => {
    await seedLibrary();
    const first = await buildLibraryBackup();

    expect(first.app).toBe('carmen');
    expect(first.kind).toBe('library-backup');
    expect(first.version).toBe(1);
    expect(first.playlists).toHaveLength(2);
    expect(first.favorites.map((entry) => entry.videoId)).toEqual(['v2', 'v9']);
    expect(first.downloads).toHaveLength(1);
    expect(first.downloads[0]).toMatchObject({ videoId: 'v1', bytes: 12345 });

    const text = serializeLibraryBackup(first);
    wipeStores();

    const parsed = parseLibraryBackup(text);
    const applied = await applyLibraryBackup(parsed);
    expect(applied).toEqual({ playlists: 2, favorites: 2 });

    const second = await buildLibraryBackup();
    expect(byName(second.playlists)).toEqual(byName(first.playlists));
    expect(second.favorites).toEqual(first.favorites);
    // Downloads restore as metadata only: no download records come back.
    expect(second.downloads).toEqual([]);
  });

  it('re-adding favorites is additive — a second restore adds no hearts twice', async () => {
    await seedLibrary();
    const backup = await buildLibraryBackup();
    wipeStores();
    await applyLibraryBackup(backup);
    const again = await applyLibraryBackup(backup);
    expect(again.favorites).toBe(0);
    expect(again.playlists).toBe(2);
  });
});

describe('parseLibraryBackup', () => {
  it('rejects garbage and foreign files with a readable message', () => {
    expect(() => parseLibraryBackup('')).toThrow(/empty/);
    expect(() => parseLibraryBackup('not json {')).toThrow(/not valid JSON/);
    expect(() => parseLibraryBackup('{"hello":"world"}')).toThrow(/not a Carmen library backup/);
    expect(() =>
      parseLibraryBackup(
        JSON.stringify({ app: 'other', kind: 'library-backup', version: 1, exportedAt: 'x', playlists: [] }),
      ),
    ).toThrow(/not a Carmen library backup/);
    expect(() =>
      parseLibraryBackup(
        JSON.stringify({ app: 'carmen', kind: 'something-else', version: 1, exportedAt: 'x', playlists: [] }),
      ),
    ).toThrow(/not a Carmen library backup/);
    expect(() =>
      parseLibraryBackup(
        JSON.stringify({ app: 'carmen', kind: 'library-backup', version: 2, exportedAt: 'x', playlists: [] }),
      ),
    ).toThrow(/version 2/);
  });
});

describe('backupFileName', () => {
  it('formats the dated file name', () => {
    expect(backupFileName(new Date(2026, 9, 23))).toBe('carmen-library-2026-10-23.json');
    expect(backupFileName(new Date(2026, 0, 5))).toBe('carmen-library-2026-01-05.json');
  });
});
