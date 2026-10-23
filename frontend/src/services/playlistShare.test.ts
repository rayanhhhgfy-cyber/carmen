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
  serverOutdatedMessage: (feature: string) =>
    `${feature} isn't available on this Carmen server yet — api.test is running an older Carmen build without the import & sharing endpoints. Update the server to the latest Carmen and try again. Browsing and playback are unaffected.`,
  isOutdatedServerMessage: (text: unknown) =>
    typeof text === 'string' && text.includes("isn't available on this Carmen server yet"),
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
  __resetShareRegistryCacheForTests,
  buildPlaylistShareUrl,
  decodeSharePayload,
  encodeSharePayload,
  getStoredShareCode,
  importSharedPlaylist,
  parsePlaylistShareCode,
  resolveSharedPlaylist,
  sharePlaylistOnline,
} from './playlistShare';

/** A fetch stub whose registry probe answers JSON (registry exists). */
function registryPresentFetch() {
  return vi.fn(async (..._args: unknown[]) => ({
    status: 404,
    ok: false,
    text: async () => JSON.stringify({ detail: 'Shared playlist not found' }),
    json: async () => ({ detail: 'Shared playlist not found' }),
  }));
}

/** A fetch stub whose registry probe answers the SPA HTML (no registry). */
function registryAbsentFetch() {
  return vi.fn(async (..._args: unknown[]) => ({
    status: 200,
    ok: true,
    text: async () => '<!doctype html><html><head><title>Carmen</title></head></html>',
    json: async () => {
      throw new Error('not json');
    },
  }));
}

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
  __resetShareRegistryCacheForTests();
  // Default probe answer: the registry exists (JSON), so the registry
  // tests below exercise the server path as before Worker D.
  vi.stubGlobal('fetch', registryPresentFetch());
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

  it('maps a 405 from an outdated server to the outdated message, not "Method Not Allowed"', async () => {
    apiPostJsonMock.mockRejectedValue(
      Object.assign(new Error('Method Not Allowed'), { status: 405 }),
    );
    await expect(sharePlaylistOnline(playlist, [])).rejects.toThrow(
      /Playlist sharing isn't available on this Carmen server yet — api\.test is running an older Carmen build/,
    );
  });

  it('maps a null payload (SPA fallback) to the outdated message', async () => {
    apiPostJsonMock.mockResolvedValue(null);
    await expect(sharePlaylistOnline(playlist, [])).rejects.toThrow(
      /Playlist sharing isn't available on this Carmen server yet/,
    );
  });
});

describe('resolveSharedPlaylist', () => {
  it('throws the outdated message on a null payload instead of fabricating an empty playlist', async () => {
    apiGetMock.mockResolvedValue(null);
    await expect(resolveSharedPlaylist(CODE)).rejects.toThrow(
      /Playlist sharing isn't available on this Carmen server yet — api\.test is running an older Carmen build/,
    );
  });

  it('throws the outdated message on a payload with no tracks, name or code', async () => {
    apiGetMock.mockResolvedValue({ unexpected: true });
    await expect(resolveSharedPlaylist(CODE)).rejects.toThrow(/older Carmen build/);
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

/* ── self-contained payload shares (plz_…) ─────────────────────────────── */

describe('payload share codec', () => {
  const richSong: Track = {
    ...track('v1', 'One', 'Artist'),
    artists: ['Artist', 'Guest'],
    artist: 'Artist, Guest',
    albumName: 'Alb',
    duration: '3:22',
    durationSeconds: 202,
    artwork: 'https://i.ytimg.com/vi/v1/maxresdefault.jpg',
    isExplicit: true,
  };

  it('round-trips name, description and the track fields normalizeTrack needs', async () => {
    expect(typeof CompressionStream).toBe('function');
    const token = await encodeSharePayload(
      { name: 'Payload Mix', description: 'No server needed', artwork: richSong.artwork },
      [richSong, track('v2', 'Two', 'Duo')],
    );
    expect(token.startsWith('plz_')).toBe(true);

    const decoded = await decodeSharePayload(token);
    expect(decoded.code).toBe(token);
    expect(decoded.name).toBe('Payload Mix');
    expect(decoded.description).toBe('No server needed');
    expect(decoded.tracks).toHaveLength(2);
    expect(decoded.tracks[0]).toMatchObject({
      videoId: 'v1',
      title: 'One',
      artist: 'Artist, Guest',
      albumName: 'Alb',
      durationSeconds: 202,
      artwork: 'https://i.ytimg.com/vi/v1/maxresdefault.jpg',
      isExplicit: true,
    });
    expect(decoded.tracks[0]?.artists).toEqual(['Artist', 'Guest']);
    expect(decoded.tracks[1]).toMatchObject({ videoId: 'v2', title: 'Two', artist: 'Duo' });
  });

  it('parses plz_ tokens bare and from ?pl= URLs', () => {
    const token = 'plz_AbC-123_xYz';
    expect(parsePlaylistShareCode(token)).toBe(token);
    expect(parsePlaylistShareCode(`https://carmen.example/?pl=${token}`)).toBe(token);
    expect(parsePlaylistShareCode(`https://carmen.example/?x=1&pl=${token}#/library`)).toBe(token);
    // Registry codes still parse, and plz_ is not swallowed by pl_ patterns.
    expect(parsePlaylistShareCode(CODE)).toBe(CODE);
  });

  it('resolves a plz_ token locally without touching the registry', async () => {
    const token = await encodeSharePayload({ name: 'Local Mix', description: null, artwork: null }, [
      track('v9', 'Nine'),
    ]);
    const resolved = await resolveSharedPlaylist(token);
    expect(resolved.name).toBe('Local Mix');
    expect(resolved.tracks.map((entry) => entry.videoId)).toEqual(['v9']);
    expect(apiGetMock).not.toHaveBeenCalled();
    // …and via a full share URL, the way the gate / dialog pass it in.
    const viaUrl = await resolveSharedPlaylist(`https://carmen.example/?pl=${token}`);
    expect(viaUrl.name).toBe('Local Mix');
    expect(apiGetMock).not.toHaveBeenCalled();
  });

  it('rejects a damaged payload token', async () => {
    await expect(decodeSharePayload('plz_not-base64-gzip!!!'.replace(/!/g, 'A'))).rejects.toThrow(
      /damaged|newer browser/,
    );
    await expect(resolveSharedPlaylist('plz_AAAA')).rejects.toThrow(/damaged|newer browser/);
  });
});

describe('sharePlaylistOnline probe selection', () => {
  const playlist: Playlist = {
    id: 9,
    name: 'Probe Mix',
    description: 'probe',
    coverVideoId: null,
    isFavorite: false,
    position: 0,
    trackCount: 1,
    createdAt: 1,
    updatedAt: 1,
  };

  it('uses the registry when the probe answers JSON (404)', async () => {
    vi.stubGlobal('fetch', registryPresentFetch());
    apiPostJsonMock.mockResolvedValue({ code: CODE });
    const result = await sharePlaylistOnline(playlist, [track('v1', 'One')]);
    expect(result).toEqual({ code: CODE, url: `https://carmen.example/?pl=${CODE}` });
    expect(apiPostJsonMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to a self-contained payload link when the probe answers HTML', async () => {
    vi.stubGlobal('fetch', registryAbsentFetch());
    const result = await sharePlaylistOnline(playlist, [track('v1', 'One'), track('v2', 'Two')]);
    expect(apiPostJsonMock).not.toHaveBeenCalled();
    expect(result.code.startsWith('plz_')).toBe(true);
    expect(result.url).toBe(`https://carmen.example/?pl=${result.code}`);
    expect(result.url.length).toBeLessThanOrEqual(8000);
    const decoded = await decodeSharePayload(result.code);
    expect(decoded.name).toBe('Probe Mix');
    expect(decoded.tracks.map((entry) => entry.videoId)).toEqual(['v1', 'v2']);
  });

  it('falls back to a payload link when the probe cannot reach the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const result = await sharePlaylistOnline(playlist, [track('v1', 'One')]);
    expect(result.code.startsWith('plz_')).toBe(true);
    expect(apiPostJsonMock).not.toHaveBeenCalled();
  });

  it('throws a clear error when the payload link would exceed the 8000-char cap', async () => {
    vi.stubGlobal('fetch', registryAbsentFetch());
    // Incompressible titles: a seeded pseudo-random generator keeps the
    // fixture deterministic while defeating gzip.
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const songs = Array.from({ length: 120 }, (_, index) => {
      const title = Array.from({ length: 90 }, () => alphabet[Math.floor(rand() * alphabet.length)]).join('');
      return track(`vid${index}`, title);
    });
    await expect(sharePlaylistOnline(playlist, songs)).rejects.toThrow(
      /too large to share as a self-contained link without a Carmen server/,
    );
    expect(apiPostJsonMock).not.toHaveBeenCalled();
  });
});
