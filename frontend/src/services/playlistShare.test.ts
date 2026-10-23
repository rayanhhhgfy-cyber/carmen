/**
 * Unit tests for the playlist share client.
 *
 * URL build/parse are pure (with a stubbed `window.location`); the
 * registry calls run against a mocked `../api`, and importing a shared
 * playlist runs through the real playlist repos on the in-memory
 * storage mock — the same pattern as `db/repos/playlists.fallback.test`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { memTracks, memKv, memDownloads, apiGetMock, apiPostJsonMock } = vi.hoisted(() => ({
  memTracks: new Map<string, any>(),
  memKv: new Map<string, unknown>(),
  memDownloads: new Map<string, any>(),
  apiGetMock: vi.fn(),
  apiPostJsonMock: vi.fn(),
}));

vi.mock('./storage', () => ({
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

vi.mock('../api', () => ({
  apiGet: apiGetMock,
  apiPostJson: apiPostJsonMock,
  apiBase: () => 'https://api.test',
  ApiError: class ApiError extends Error {
    status: number;
    payload: unknown;
    constructor(message: string, status: number, payload: unknown) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.payload = payload;
    }
  },
}));

import { fallbackSet } from '../db/repos/fallback';
import { createPlaylist, listPlaylists, listPlaylistTracks } from '../db/repos/playlists';
import type { Playlist, Track } from '../types/models';
import {
  buildPlaylistShareUrl,
  getStoredShareCode,
  importSharedPlaylist,
  parsePlaylistShareCode,
  sharePlaylistOnline,
} from './playlistShare';

const CODE = 'pl_AbC123xYz9qw';

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

beforeEach(() => {
  memTracks.clear();
  memKv.clear();
  memDownloads.clear();
  fallbackSet('playlists', []);
  fallbackSet('favoriteIds', []);
  apiGetMock.mockReset();
  apiPostJsonMock.mockReset();
  // Web origin for the URL builder/parser (not Tauri in the test env).
  vi.stubGlobal('window', {
    location: {
      href: 'https://carmen.example/',
      origin: 'https://carmen.example',
      pathname: '/',
    },
  });
});

describe('buildPlaylistShareUrl / parsePlaylistShareCode', () => {
  it('builds a ?pl= URL on the current origin', () => {
    expect(buildPlaylistShareUrl(CODE)).toBe(`https://carmen.example/?pl=${CODE}`);
  });

  it.each([
    [`https://carmen.example/?pl=${CODE}`, CODE],
    [`https://carmen.example/?pl=${CODE}#/library`, CODE],
    [`https://other.host/app/?x=1&pl=${CODE}`, CODE],
    [CODE, CODE],
    [`  ${CODE}  `, CODE],
  ])('parses %s', (raw, expected) => {
    expect(parsePlaylistShareCode(raw)).toBe(expected);
  });

  it.each([
    '',
    '   ',
    'not a link',
    'https://carmen.example/?song=abc123',
    'https://carmen.example/?pl=',
    'pl_',
    'xx_AbC123xYz9qw',
  ])('rejects %s', (raw) => {
    expect(parsePlaylistShareCode(raw)).toBeNull();
  });

  it('round-trips a built URL', () => {
    expect(parsePlaylistShareCode(buildPlaylistShareUrl(CODE))).toBe(CODE);
  });
});

describe('sharePlaylistOnline', () => {
  const playlist: Playlist = {
    id: 7,
    name: 'Road Mix',
    description: 'For the drive',
    coverVideoId: null,
    isFavorite: false,
    position: 0,
    trackCount: 2,
    createdAt: 1,
    updatedAt: 1,
  };

  it('POSTs the share payload and stores the returned code', async () => {
    apiPostJsonMock.mockResolvedValue({ code: CODE });
    const songs = [
      track('v1', 'One'),
      {
        ...track('v2', 'Two', 'Duo'),
        artists: [{ name: 'Duo' }],
        album: { name: 'Alb', id: null },
        albumName: 'Alb',
        year: '2020',
      },
    ];

    const result = await sharePlaylistOnline(playlist, songs);

    expect(result).toEqual({ code: CODE, url: `https://carmen.example/?pl=${CODE}` });
    expect(apiPostJsonMock).toHaveBeenCalledTimes(1);
    const [path, body] = apiPostJsonMock.mock.calls[0] as [string, any];
    expect(path).toBe('/share/playlists');
    expect(body).toMatchObject({ name: 'Road Mix', description: 'For the drive' });
    expect(body.code).toBeUndefined();
    expect(body.tracks).toHaveLength(2);
    expect(body.tracks[0]).toMatchObject({ videoId: 'v1', title: 'One', artist: 'Artist' });
    expect(body.tracks[1]).toMatchObject({ videoId: 'v2', title: 'Two', artist: 'Duo' });
    // The registry's track model wants flattened types: artist names as
    // plain strings, the album as a string, the year as an int.
    expect(body.tracks[1].artists).toEqual(['Duo']);
    expect(body.tracks[1].album).toBe('Alb');
    expect(body.tracks[1].year).toBe(2020);
    // Playback-only fields never leak into the registry payload.
    expect(body.tracks[0]).not.toHaveProperty('isDownloaded');

    expect(await getStoredShareCode(7)).toBe(CODE);
  });

  it('reuses the stored code on re-share so the link stays stable', async () => {
    apiPostJsonMock.mockResolvedValue({ code: CODE });
    await sharePlaylistOnline(playlist, [track('v1', 'One')]);
    apiPostJsonMock.mockClear();
    apiPostJsonMock.mockResolvedValue({ code: CODE });

    const again = await sharePlaylistOnline(playlist, [track('v1', 'One'), track('v3', 'Three')]);

    const [, body] = apiPostJsonMock.mock.calls[0] as [string, any];
    expect(body.code).toBe(CODE);
    expect(body.tracks).toHaveLength(2);
    expect(again.url).toBe(`https://carmen.example/?pl=${CODE}`);
  });

  it('throws when the server answers without a code', async () => {
    apiPostJsonMock.mockResolvedValue({});
    await expect(sharePlaylistOnline(playlist, [])).rejects.toThrow(/share code/);
  });
});

describe('importSharedPlaylist', () => {
  it('creates a library playlist with the shared tracks in order', async () => {
    apiGetMock.mockResolvedValue({
      code: CODE,
      name: 'Shared Mix',
      description: 'From a friend',
      artwork: null,
      sharedAt: '2026-10-23T00:00:00Z',
      tracks: [
        {
          videoId: 'yt1',
          title: 'Song One',
          artists: [{ name: 'Artist' }],
          duration: '3:00',
          thumbnails: [],
        },
        {
          videoId: 'yt2',
          title: 'Song Two',
          artists: [{ name: 'Duo' }],
          duration: '2:30',
          thumbnails: [],
        },
      ],
    });

    const playlistId = await importSharedPlaylist(`https://carmen.example/?pl=${CODE}`);

    expect(apiGetMock).toHaveBeenCalledWith(`/share/playlists/${CODE}`);
    const songs = await listPlaylistTracks(playlistId);
    expect(songs.map((song) => song.videoId)).toEqual(['yt1', 'yt2']);
    expect(songs.map((song) => song.title)).toEqual(['Song One', 'Song Two']);

    const lists = await listPlaylists();
    const created = lists.find((entry) => entry.id === playlistId);
    expect(created?.name).toBe('Shared Mix');
    expect(created?.description).toBe('From a friend');
    expect(created?.trackCount).toBe(2);
  });

  it('accepts a bare code as well as a link', async () => {
    apiGetMock.mockResolvedValue({ code: CODE, name: 'Bare', description: null, tracks: [] });
    const playlistId = await importSharedPlaylist(CODE);
    expect(apiGetMock).toHaveBeenCalledWith(`/share/playlists/${CODE}`);
    expect(await listPlaylistTracks(playlistId)).toEqual([]);
    // Silence the unused warning for the seeding helper in this branch.
    expect(typeof createPlaylist).toBe('function');
  });
});
