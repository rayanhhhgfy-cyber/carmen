/**
 * `ensureCollectionPlaylist` — the save-to-library step of downloading a
 * remote playlist / album (CollectionPage).
 *
 * Pinned behaviour (browser fallback storage, like the playlist repo's
 * own tests): the first save creates a playlist with the tracks in
 * order; an identical second save reuses it instead of duplicating;
 * a same-named playlist with different or reordered tracks does *not*
 * count as the same collection.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { memTracks, memKv } = vi.hoisted(() => ({
  memTracks: new Map<string, any>(),
  memKv: new Map<string, unknown>(),
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
}));

import type { Track } from '../types/models';
import { fallbackSet } from '../db/repos/fallback';
import { listPlaylists, listPlaylistTracks } from '../db/repos/playlists';
import { ensureCollectionPlaylist } from './collectionPlaylist';

function track(videoId: string, title = videoId): Track {
  return {
    videoId,
    title,
    artists: ['Artist'],
    artist: 'Artist',
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

beforeEach(() => {
  memTracks.clear();
  memKv.clear();
  fallbackSet('playlists', []);
  fallbackSet('favoriteIds', []);
});

describe('ensureCollectionPlaylist', () => {
  it('creates a playlist with the tracks in order on first save', async () => {
    const tracks = [track('v1'), track('v2'), track('v3')];
    const playlistId = await ensureCollectionPlaylist('Top Hits', tracks);

    const songs = await listPlaylistTracks(playlistId);
    expect(songs.map((s) => s.videoId)).toEqual(['v1', 'v2', 'v3']);
    const lists = await listPlaylists();
    expect(lists).toHaveLength(1);
    expect(lists[0]?.name).toBe('Top Hits');
  });

  it('reuses the existing playlist when name and ordered tracks match', async () => {
    const tracks = [track('v1'), track('v2')];
    const first = await ensureCollectionPlaylist('Top Hits', tracks);
    const second = await ensureCollectionPlaylist('Top Hits', tracks);

    expect(second).toBe(first);
    expect(await listPlaylists()).toHaveLength(1);
    expect((await listPlaylistTracks(first)).map((s) => s.videoId)).toEqual(['v1', 'v2']);
  });

  it('creates a new playlist when the order differs', async () => {
    const first = await ensureCollectionPlaylist('Top Hits', [track('v1'), track('v2')]);
    const second = await ensureCollectionPlaylist('Top Hits', [track('v2'), track('v1')]);

    expect(second).not.toBe(first);
    expect(await listPlaylists()).toHaveLength(2);
  });

  it('creates a new playlist when a same-named one holds other tracks', async () => {
    const first = await ensureCollectionPlaylist('Top Hits', [track('v1'), track('v2')]);
    const second = await ensureCollectionPlaylist('Top Hits', [track('v1'), track('v9')]);

    expect(second).not.toBe(first);
    expect(await listPlaylists()).toHaveLength(2);
    expect((await listPlaylistTracks(second)).map((s) => s.videoId)).toEqual(['v1', 'v9']);
  });

  it('skips tracks without a videoId', async () => {
    const playlistId = await ensureCollectionPlaylist('Sparse', [
      track('v1'),
      track(''),
      track('v2'),
    ]);

    expect((await listPlaylistTracks(playlistId)).map((s) => s.videoId)).toEqual([
      'v1',
      'v2',
    ]);
  });
});
