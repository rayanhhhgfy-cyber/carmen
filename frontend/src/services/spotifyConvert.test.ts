/**
 * Unit tests for the universal import client helpers.
 *
 * Covers the pure functions (link parsing / detection, error mapping) —
 * the network calls and the SSE stream are exercised against a stubbed
 * `fetch` (the resolve preview mapping and the conversion stream's
 * `source` field handling included).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api';

const { resolveSharedPlaylistMock } = vi.hoisted(() => ({
  resolveSharedPlaylistMock: vi.fn(),
}));

vi.mock('./playlistShare', () => ({
  resolveSharedPlaylist: resolveSharedPlaylistMock,
}));

import {
  __resetConvertProbeForTests,
  APPLE_PLAYLIST_MESSAGE,
  convertImportSource,
  convertServerAvailable,
  convertSpotifyPlaylist,
  detectImportLink,
  friendlyConvertError,
  parseSpotifyPlaylistUrl,
  resolveImportSource,
  type TrackConversion,
} from './spotifyConvert';

const ID = '37i9dQZF1DXcBWIGoYBM5M';

describe('parseSpotifyPlaylistUrl', () => {
  it.each([
    `https://open.spotify.com/playlist/${ID}`,
    `https://open.spotify.com/playlist/${ID}?si=abc123`,
    `http://open.spotify.com/playlist/${ID}`,
    `https://open.spotify.com/intl-de/playlist/${ID}?si=x`,
    `spotify:playlist:${ID}`,
    ID,
    `  https://open.spotify.com/playlist/${ID}  `,
  ])('accepts %s', (raw) => {
    expect(parseSpotifyPlaylistUrl(raw)).toBe(ID);
  });

  it.each([
    '',
    '   ',
    'not a link',
    'https://open.spotify.com/track/abc123',
    'https://open.spotify.com/album/37i9dQZF1DXcBWIGoYBM5M',
    'https://youtube.com/playlist?list=PL123',
    'spotify:track:abc123',
    'too-short',
  ])('rejects %s', (raw) => {
    expect(parseSpotifyPlaylistUrl(raw)).toBeNull();
  });
});

describe('friendlyConvertError', () => {
  it('explains an unreachable server', () => {
    expect(friendlyConvertError(0, '')).toMatch(/Cannot reach the server/);
  });

  it('tells the user to update an old server on /convert 404s', () => {
    expect(friendlyConvertError(404, 'Not Found: /convert/spotify/playlist')).toMatch(
      /Playlist import isn't available on this Carmen server yet/,
    );
  });

  it('maps a bare FastAPI "Not Found" 404 (missing /convert route) to the outdated message', () => {
    expect(friendlyConvertError(404, 'Not Found')).toMatch(
      /Playlist import isn't available on this Carmen server yet — api-carmen-v1\.syr\.qzz\.io is running an older Carmen build/,
    );
  });

  it('maps a 405 "Method Not Allowed" (outdated server POST fallback) to the outdated message', () => {
    expect(friendlyConvertError(405, 'Method Not Allowed')).toMatch(
      /Playlist import isn't available on this Carmen server yet/,
    );
  });

  it('passes the outdated message through verbatim', () => {
    const outdated = friendlyConvertError(405, 'Method Not Allowed');
    expect(friendlyConvertError(404, outdated)).toBe(outdated);
    expect(friendlyConvertError(new ApiError(outdated, 404, null))).toBe(outdated);
  });

  it('explains a missing/private playlist on descriptive 404s', () => {
    expect(
      friendlyConvertError(404, "Spotify couldn't find that item — it may be private, deleted, or the link is wrong."),
    ).toMatch(/private/);
  });

  it('passes bad-request detail through', () => {
    expect(friendlyConvertError(400, 'Custom detail')).toBe('Custom detail');
  });

  it('treats other 503s as Spotify being busy', () => {
    expect(friendlyConvertError(503, 'rate limited')).toMatch(/busy right now/);
  });

  it('falls back to the raw detail', () => {
    expect(friendlyConvertError(502, 'Bad gateway')).toBe('Bad gateway');
  });

  it('accepts an ApiError object (the dialog passes the caught error)', () => {
    expect(friendlyConvertError(new ApiError('Not Found', 404, null))).toMatch(
      /Playlist import isn't available on this Carmen server yet/,
    );
    expect(friendlyConvertError(new ApiError('Custom detail', 400, null))).toBe('Custom detail');
    expect(friendlyConvertError(new ApiError('Cannot reach the server', 0, null))).toMatch(
      /Cannot reach the server/,
    );
  });

  it('explains rate limiting', () => {
    expect(friendlyConvertError(429, '')).toMatch(/wait a minute/);
  });

  it('names YouTube on YouTube-flavoured 404s', () => {
    expect(friendlyConvertError(404, 'youtube video not found')).toMatch(/YouTube couldn/);
  });

  it("surfaces the server's precise Apple-playlist rejection verbatim", () => {
    const precise =
      'Apple Music playlists can\u2019t be imported \u2014 Apple does not expose playlist contents without a developer token.';
    expect(friendlyConvertError(404, precise)).toBe(precise);
    expect(friendlyConvertError(400, precise)).toBe(precise);
  });
});

describe('detectImportLink', () => {
  it.each([
    // Spotify — playlist / album / track / artist, URL + URI + bare id.
    [`https://open.spotify.com/playlist/${ID}`, 'spotify-playlist', ID],
    [`https://open.spotify.com/playlist/${ID}?si=abc123`, 'spotify-playlist', ID],
    [`https://open.spotify.com/intl-de/playlist/${ID}`, 'spotify-playlist', ID],
    [`spotify:playlist:${ID}`, 'spotify-playlist', ID],
    [ID, 'spotify-playlist', ID],
    ['https://open.spotify.com/album/4LH4d3cOWNNsVw41Gqt2kv', 'spotify-album', '4LH4d3cOWNNsVw41Gqt2kv'],
    ['spotify:album:4LH4d3cOWNNsVw41Gqt2kv', 'spotify-album', '4LH4d3cOWNNsVw41Gqt2kv'],
    ['https://open.spotify.com/track/7ouMYWpwJ422jRcDASZB7P', 'spotify-track', '7ouMYWpwJ422jRcDASZB7P'],
    ['spotify:track:7ouMYWpwJ422jRcDASZB7P', 'spotify-track', '7ouMYWpwJ422jRcDASZB7P'],
    ['https://open.spotify.com/artist/06HL4z0CvFAxyc27GXpf02', 'spotify-artist', '06HL4z0CvFAxyc27GXpf02'],
    // Apple Music — album (numeric catalogue id) and playlist (pl.… id).
    ['https://music.apple.com/us/album/thriller/269572838', 'apple-album', '269572838'],
    ['https://music.apple.com/gb/album/269572838', 'apple-album', '269572838'],
    ['https://music.apple.com/us/playlist/todays-hits/pl.u-abcDEF123', 'apple-playlist', 'pl.u-abcDEF123'],
    ['https://music.apple.com/us/playlist/pl.1234567890abcdef', 'apple-playlist', 'pl.1234567890abcdef'],
    // YouTube / YouTube Music — videos and playlists.
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube-video', 'dQw4w9WgXcQ'],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube-video', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'youtube-video', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'youtube-video', 'dQw4w9WgXcQ'],
    [
      'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf',
      'youtube-playlist',
      'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf',
    ],
    [
      'https://music.youtube.com/playlist?list=OLAK5uy_test1234',
      'youtube-playlist',
      'OLAK5uy_test1234',
    ],
    // Carmen shares — full `?pl=` URL and the bare code.
    ['https://carmen.example/?pl=pl_AbC123xYz9qw', 'carmen-share', 'pl_AbC123xYz9qw'],
    ['https://carmen.example/?pl=pl_AbC123xYz9qw#/library', 'carmen-share', 'pl_AbC123xYz9qw'],
    ['pl_AbC123xYz9qw', 'carmen-share', 'pl_AbC123xYz9qw'],
  ])('classifies %s', (raw, kind, id) => {
    expect(detectImportLink(raw)).toEqual({ kind, id });
  });

  it.each([
    '',
    '   ',
    'just some words',
    'https://example.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
    'https://open.spotify.com/playlist/too-short',
    'https://open.spotify.com/user/someone',
    'spotify:playlist:short',
    'https://music.apple.com/us/artist/someone/123456789',
    'https://music.apple.com/us/album/thriller/not-a-number',
    'https://www.youtube.com/watch?v=tooshort',
    'https://www.youtube.com/feed/subscriptions',
    'https://youtu.be/',
    'pl_',
  ])('rejects %s', (raw) => {
    expect(detectImportLink(raw)).toBeNull();
  });
});

/* ── network shapes (fetch stubbed) ───────────────────────────────────── */

const SHARE_CODE = 'pl_AbC123xYz9qw';

beforeAll(() => {
  // `apiGet` builds its URL against `window.location.href`.
  vi.stubGlobal('window', {
    location: {
      href: 'https://carmen.example/',
      origin: 'https://carmen.example',
      pathname: '/',
    },
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}

describe('resolveImportSource', () => {
  it('maps the universal resolve payload into an ImportPreview', async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) =>
      jsonResponse({
        source: {
          kind: 'spotify-playlist',
          id: ID,
          name: 'Test Mix',
          owner: 'Tester',
          artwork: 'https://img.example/cover.jpg',
          url: `https://open.spotify.com/playlist/${ID}`,
          trackCount: 2,
        },
        tracks: [
          {
            id: 'sp1',
            title: 'One',
            artists: ['Artist'],
            artist: 'Artist',
            album: 'Album',
            artwork: null,
            duration_ms: 180000,
            url: 'https://open.spotify.com/track/sp1',
            explicit: false,
            source: 'spotify',
          },
          {
            id: 'sp2',
            title: 'Two',
            artists: ['A', 'B'],
            artist: 'A, B',
            album: null,
            artwork: null,
            duration_ms: null,
            spotify_url: 'https://open.spotify.com/track/sp2',
            explicit: true,
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const preview = await resolveImportSource(`https://open.spotify.com/playlist/${ID}`);

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/convert/resolve');
    expect(preview.source).toMatchObject({
      kind: 'spotify-playlist',
      id: ID,
      name: 'Test Mix',
      owner: 'Tester',
      trackCount: 2,
    });
    expect(preview.tracks).toHaveLength(2);
    expect(preview.tracks[0]).toMatchObject({
      id: 'sp1',
      title: 'One',
      url: 'https://open.spotify.com/track/sp1',
      source: 'spotify',
      duration_ms: 180000,
    });
    // snake_case `spotify_url` is folded into `url`; a missing `source`
    // falls back to the detected kind.
    expect(preview.tracks[1]).toMatchObject({
      id: 'sp2',
      url: 'https://open.spotify.com/track/sp2',
      spotify_url: 'https://open.spotify.com/track/sp2',
      source: 'spotify-playlist',
      album: null,
      duration_ms: null,
      explicit: true,
    });
  });

  it('rejects unrecognised links without calling the server', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(resolveImportSource('not a link at all')).rejects.toThrow(/supported link/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a null payload (outdated server SPA fallback, HTML 200) with the outdated message naming the host', async () => {
    // `apiGet` parses the fallback's index.html body as `null`.
    vi.stubGlobal('fetch', vi.fn(async (..._args: unknown[]) => jsonResponse(null)));
    await expect(
      resolveImportSource(`https://open.spotify.com/playlist/${ID}`),
    ).rejects.toThrow(
      /Playlist import isn't available on this Carmen server yet — api-carmen-v1\.syr\.qzz\.io is running an older Carmen build without the import & sharing endpoints/,
    );
  });

  it('rejects a payload with no recognised preview keys with the outdated message', async () => {
    vi.stubGlobal('fetch', vi.fn(async (..._args: unknown[]) => jsonResponse({ hello: 'world' })));
    await expect(
      resolveImportSource(`https://open.spotify.com/playlist/${ID}`),
    ).rejects.toThrow(/Playlist import isn't available on this Carmen server yet/);
  });
});

const SSE_BODY = [
  'event: start',
  'data: {"total":2,"source":{"id":"src1","name":"Mix","owner":"Tester","artwork":null}}',
  '',
  'event: progress',
  'data: {"done":1,"total":2,"result":{"source":{"id":"s1","title":"One","artists":["Artist"],"artist":"Artist","album":"Alb","artwork":null,"duration_ms":1000,"url":"https://open.spotify.com/track/s1","explicit":false,"source":"spotify-playlist"},"status":"matched","confidence":0.9,"match":{"videoId":"yt1","title":"One"},"error":null}}',
  '',
  'event: progress',
  'data: {"done":2,"total":2,"result":{"spotify":{"id":"s2","title":"Two","artists":["Artist"],"artist":"Artist","album":null,"artwork":null,"duration_ms":2000,"spotify_url":"https://open.spotify.com/track/s2","explicit":false},"status":"not_found","confidence":0,"match":null,"error":null}}',
  '',
  'event: done',
  'data: {"summary":{"total":2,"matched":1,"approximate":0,"not_found":1,"error":0}}',
  '',
  '',
].join('\n');

function sseResponse() {
  const encoder = new TextEncoder();
  return {
    ok: true,
    status: 200,
    json: async () => null,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(SSE_BODY));
        controller.close();
      },
    }),
  } as unknown as Response;
}

describe('convertImportSource', () => {
  it('streams SSE results keyed by `source` (legacy `spotify` tolerated)', async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => sseResponse());
    vi.stubGlobal('fetch', fetchMock);
    const progress: { done: number; total: number; result: TrackConversion }[] = [];

    const results = await convertImportSource(
      `https://open.spotify.com/playlist/${ID}`,
      (event) => progress.push(event),
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/convert/to-ytmusic');
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      status: 'matched',
      confidence: 0.9,
      source: { id: 's1', title: 'One', source: 'spotify-playlist' },
    });
    expect(results[0]?.match).toMatchObject({ videoId: 'yt1' });
    // The legacy payload's `spotify` field lands in `source`, with its
    // `spotify_url` folded into `url`.
    expect(results[1]).toMatchObject({
      status: 'not_found',
      source: { id: 's2', url: 'https://open.spotify.com/track/s2' },
    });
    expect(progress.map((event) => event.done)).toEqual([1, 2]);
    expect(progress[0]?.result.source.id).toBe('s1');
  });

  it('keeps the legacy wrapper outcome shape (results + summary + playlist)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse()));
    const outcome = await convertSpotifyPlaylist(`https://open.spotify.com/playlist/${ID}`, () => {});
    expect(outcome.results).toHaveLength(2);
    expect(outcome.summary).toMatchObject({ total: 2, matched: 1, not_found: 1 });
    expect(outcome.playlist).toEqual({ id: 'src1', name: 'Mix', owner: 'Tester', artwork: null });
  });

  it('rejects a 405 convert answer (outdated server) with the outdated message, never "Method Not Allowed"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (..._args: unknown[]) => ({
        ok: false,
        status: 405,
        json: async () => ({ detail: 'Method Not Allowed' }),
      }) as unknown as Response),
    );
    await expect(
      convertImportSource(`https://open.spotify.com/playlist/${ID}`, () => {}),
    ).rejects.toThrow(/Playlist import isn't available on this Carmen server yet/);
  });

  it('rejects a 200 text/html convert answer (outdated server SPA fallback) with the outdated message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (..._args: unknown[]) => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        json: async () => null,
        body: null,
      }) as unknown as Response),
    );
    await expect(
      convertImportSource(`https://open.spotify.com/playlist/${ID}`, () => {}),
    ).rejects.toThrow(/Playlist import isn't available on this Carmen server yet/);
  });

  it('refuses Carmen share links — they import directly, never convert', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(convertImportSource(SHARE_CODE, () => {})).rejects.toThrow(/imports directly/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/* ── plz_ payload shares (Worker D) ───────────────────────────────────── */

const PLZ_TOKEN = 'plz_AbC-123_xYzPayload';

describe('detectImportLink — plz_ payload shares', () => {
  it('classifies a bare plz_ token as a Carmen share', () => {
    expect(detectImportLink(PLZ_TOKEN)).toEqual({ kind: 'carmen-share', id: PLZ_TOKEN });
  });

  it('classifies a ?pl=plz_… URL as a Carmen share', () => {
    expect(detectImportLink(`https://carmen.example/?pl=${PLZ_TOKEN}`)).toEqual({
      kind: 'carmen-share',
      id: PLZ_TOKEN,
    });
    expect(detectImportLink(`https://carmen.example/?x=1&pl=${PLZ_TOKEN}#/library`)).toEqual({
      kind: 'carmen-share',
      id: PLZ_TOKEN,
    });
  });

  it('resolves a plz_ share through playlistShare (which decodes it locally)', async () => {
    resolveSharedPlaylistMock.mockReset();
    resolveSharedPlaylistMock.mockResolvedValue({
      code: PLZ_TOKEN,
      name: 'Payload Mix',
      description: 'self-contained',
      artwork: null,
      tracks: [
        {
          videoId: 'yt1',
          title: 'One',
          artists: ['Artist'],
          artist: 'Artist',
          album: null,
          albumName: '',
          duration: '3:00',
          durationSeconds: 180,
          artwork: null,
          year: null,
          releaseDate: null,
          isExplicit: false,
          playlistId: null,
        },
      ],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const preview = await resolveImportSource(PLZ_TOKEN);
    expect(resolveSharedPlaylistMock).toHaveBeenCalledWith(PLZ_TOKEN);
    expect(preview.source).toMatchObject({ kind: 'carmen-share', name: 'Payload Mix', trackCount: 1 });
    expect(preview.tracks[0]).toMatchObject({ id: 'yt1', title: 'One', duration_ms: 180000 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/* ── client-driven resolve + convert (probe: no /convert/*) ──────────── */

function clientJson(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  } as unknown as Response;
}

function clientHtml() {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    text: async () => '<!doctype html><html><head><title>Carmen</title></head></html>',
    json: async () => {
      throw new Error('not json');
    },
  } as unknown as Response;
}

const HELPER_PAYLOAD = {
  source: {
    kind: 'spotify-playlist',
    id: ID,
    name: 'Helper Mix',
    owner: 'Spotify',
    artwork: null,
    url: `https://open.spotify.com/playlist/${ID}`,
    track_count: 2,
  },
  tracks: [
    {
      id: 'sp1',
      title: 'Blinding Lights',
      artists: ['The Weeknd'],
      artist: 'The Weeknd',
      album: null,
      artwork: null,
      duration_ms: 202000,
      url: 'https://open.spotify.com/track/sp1',
      explicit: false,
      isrc: null,
    },
    {
      id: 'sp2',
      title: 'Obscure Song',
      artists: ['Nobody'],
      artist: 'Nobody',
      album: null,
      artwork: null,
      duration_ms: 100000,
      url: 'https://open.spotify.com/track/sp2',
      explicit: false,
      isrc: null,
    },
  ],
};

const PERFECT_CANDIDATE = {
  videoId: 'J7p4bzqLvCw',
  title: 'Blinding Lights',
  artists: [{ name: 'The Weeknd' }],
  duration: '3:22',
  duration_seconds: 202,
  thumbnails: [{ url: 'https://i.ytimg.com/vi/J7p4bzqLvCw/hqdefault.jpg' }],
};

type RouteHandler = (url: URL) => unknown;

function routeFetch(routes: { probe?: 'json' | 'html' | 'down'; helper?: RouteHandler; api?: RouteHandler }) {
  return vi.fn(async (input: unknown, _init?: unknown) => {
    const url = new URL(String(input));
    if (url.pathname === '/convert/resolve' && url.searchParams.get('url') === '__carmen_probe__') {
      if (routes.probe === 'down') throw new Error('network down');
      return routes.probe === 'json'
        ? clientJson({ detail: 'bad url' }, 400)
        : clientHtml();
    }
    if (url.origin === 'https://carmen.example' && url.pathname === '/api/resolve') {
      return routes.helper ? routes.helper(url) : clientHtml();
    }
    if (url.hostname === 'itunes.apple.com') {
      return routes.api ? routes.api(url) : clientJson({ results: [] });
    }
    if (url.hostname === 'api-carmen-v1.syr.qzz.io' && routes.api) {
      return routes.api(url);
    }
    throw new Error(`unexpected fetch: ${url.href}`);
  });
}

describe('convertServerAvailable probe', () => {
  beforeEach(() => {
    __resetConvertProbeForTests();
  });

  it('treats a JSON answer (even a 400) as available', async () => {
    vi.stubGlobal('fetch', routeFetch({ probe: 'json' }));
    await expect(convertServerAvailable()).resolves.toBe(true);
  });

  it('treats the SPA HTML fallback as unavailable', async () => {
    vi.stubGlobal('fetch', routeFetch({ probe: 'html' }));
    await expect(convertServerAvailable()).resolves.toBe(false);
  });

  it('treats a network failure as unavailable', async () => {
    vi.stubGlobal('fetch', routeFetch({ probe: 'down' }));
    await expect(convertServerAvailable()).resolves.toBe(false);
  });

  it('probes only once per session', async () => {
    const fetchMock = routeFetch({ probe: 'html' });
    vi.stubGlobal('fetch', fetchMock);
    await convertServerAvailable();
    await convertServerAvailable();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('client-driven resolve (no server endpoints)', () => {
  beforeEach(() => {
    __resetConvertProbeForTests();
  });

  it('resolves a Spotify playlist through the same-origin /api/resolve helper', async () => {
    const fetchMock = routeFetch({
      probe: 'html',
      helper: () => clientJson(HELPER_PAYLOAD),
    });
    vi.stubGlobal('fetch', fetchMock);
    const preview = await resolveImportSource(`https://open.spotify.com/playlist/${ID}`);
    expect(preview.source).toMatchObject({ kind: 'spotify-playlist', name: 'Helper Mix', trackCount: 2 });
    expect(preview.tracks[0]).toMatchObject({ id: 'sp1', title: 'Blinding Lights', duration_ms: 202000 });
    const helperCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/api/resolve'));
    expect(String(helperCall?.[0])).toContain('carmen.example/api/resolve?url=');
  });

  it('falls back to the outdated message when the helper answers HTML', async () => {
    vi.stubGlobal('fetch', routeFetch({ probe: 'html', helper: () => clientHtml() }));
    await expect(resolveImportSource(`https://open.spotify.com/playlist/${ID}`)).rejects.toThrow(
      /Playlist import isn't available on this Carmen server yet/,
    );
  });

  it('surfaces the helper’s descriptive 404 (Spotify not found)', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({
        probe: 'html',
        helper: () =>
          clientJson(
            { detail: 'Spotify couldn\u2019t find that playlist \u2014 it may be private, deleted, or the link is wrong.' },
            404,
          ),
      }),
    );
    await expect(resolveImportSource(`https://open.spotify.com/playlist/${ID}`)).rejects.toThrow(
      /couldn\u2019t find that playlist/,
    );
  });

  it('resolves an Apple album directly via iTunes Lookup, sorted by disc/track', async () => {
    const fetchMock = routeFetch({
      probe: 'html',
      api: () =>
        clientJson({
          resultCount: 3,
          results: [
            {
              wrapperType: 'collection',
              collectionId: 269572838,
              collectionName: 'Thriller',
              artistName: 'Michael Jackson',
              artworkUrl100: 'https://is1.mzstatic.com/image/thumb/100x100bb.jpg',
              collectionViewUrl: 'https://music.apple.com/us/album/thriller/269572838',
            },
            {
              wrapperType: 'track',
              trackId: 269573364,
              trackName: 'Beat It',
              artistName: 'Michael Jackson',
              collectionName: 'Thriller',
              artworkUrl100: 'https://is1.mzstatic.com/image/thumb/100x100bb.jpg',
              trackTimeMillis: 258000,
              trackViewUrl: 'https://music.apple.com/us/song/beat-it/269573364',
              trackExplicitness: 'notExplicit',
              discNumber: 1,
              trackNumber: 2,
            },
            {
              wrapperType: 'track',
              trackId: 269573360,
              trackName: 'Wanna Be Startin\u2019 Somethin\u2019',
              artistName: 'Michael Jackson',
              collectionName: 'Thriller',
              artworkUrl100: 'https://is1.mzstatic.com/image/thumb/100x100bb.jpg',
              trackTimeMillis: 363000,
              trackViewUrl: 'https://music.apple.com/us/song/wanna/269573360',
              trackExplicitness: 'notExplicit',
              discNumber: 1,
              trackNumber: 1,
            },
          ],
        }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const preview = await resolveImportSource('https://music.apple.com/us/album/thriller/269572838');
    expect(preview.source).toMatchObject({
      kind: 'apple-album',
      name: 'Thriller',
      owner: 'Michael Jackson',
      artwork: 'https://is1.mzstatic.com/image/thumb/600x600bb.jpg',
      trackCount: 2,
    });
    expect(preview.tracks.map((track) => track.title)).toEqual([
      'Wanna Be Startin\u2019 Somethin\u2019',
      'Beat It',
    ]);
    expect(preview.tracks[0]).toMatchObject({ duration_ms: 363000, source: 'apple-album' });
    const itunesCall = fetchMock.mock.calls.find(([input]) => String(input).includes('itunes.apple.com'));
    expect(String(itunesCall?.[0])).toContain('lookup?id=269572838&entity=song');
  });

  it('rejects an Apple playlist with the precise developer-token message', async () => {
    vi.stubGlobal('fetch', routeFetch({ probe: 'html' }));
    await expect(
      resolveImportSource('https://music.apple.com/us/playlist/todays-hits/pl.u-abcDEF123'),
    ).rejects.toThrow(APPLE_PLAYLIST_MESSAGE);
  });

  it('resolves a YouTube playlist through the API’s /playlists route (old-build shape)', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({
        probe: 'html',
        api: (url) => {
          if (url.pathname.startsWith('/playlists/')) {
            return clientJson({
              title: 'YT Mix',
              author: { name: 'Chan', id: 'UC123' },
              description: '',
              trackCount: 2,
              thumbnails: [{ url: 'https://i.ytimg.com/pl.jpg', width: 100, height: 100 }],
              tracks: [
                {
                  videoId: 'aaaaaaaaaaa',
                  title: 'Song A',
                  artists: [{ name: 'Art A' }],
                  album: { name: 'Alb' },
                  duration: '3:00',
                  duration_seconds: 180,
                  thumbnails: [{ url: 'https://i.ytimg.com/a.jpg', width: 100, height: 100 }],
                  isExplicit: false,
                },
                { videoId: null, title: 'Unavailable entry' },
              ],
            });
          }
          throw new Error(`unexpected api path ${url.pathname}`);
        },
      }),
    );
    const preview = await resolveImportSource(
      'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf',
    );
    expect(preview.source).toMatchObject({ kind: 'youtube-playlist', name: 'YT Mix', owner: 'Chan' });
    expect(preview.tracks).toHaveLength(1);
    expect(preview.tracks[0]).toMatchObject({ id: 'aaaaaaaaaaa', title: 'Song A', duration_ms: 180000 });
  });

  it('resolves a YouTube video through /browsing/track', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({
        probe: 'html',
        api: (url) => {
          if (url.pathname === '/browsing/track/dQw4w9WgXcQ') {
            return clientJson({
              videoId: 'dQw4w9WgXcQ',
              title: 'Never Gonna Give You Up',
              artists: [{ name: 'Rick Astley' }],
              album: null,
              duration: '3:34',
              duration_seconds: 214,
              thumbnails: [{ url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', width: 400, height: 225 }],
              artwork: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
              isExplicit: false,
            });
          }
          throw new Error(`unexpected api path ${url.pathname}`);
        },
      }),
    );
    const preview = await resolveImportSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(preview.source).toMatchObject({ kind: 'youtube-video', name: 'Never Gonna Give You Up', trackCount: 1 });
    expect(preview.tracks[0]).toMatchObject({ id: 'dQw4w9WgXcQ', duration_ms: 214000, artist: 'Rick Astley' });
  });
});

describe('client-driven convert (no server endpoints)', () => {
  beforeEach(() => {
    __resetConvertProbeForTests();
  });

  it('matches each track against /search with the matching port, in source order', async () => {
    const fetchMock = routeFetch({
      probe: 'html',
      helper: () => clientJson(HELPER_PAYLOAD),
      api: (url) => {
        if (url.pathname === '/search') {
          const query = url.searchParams.get('query') ?? '';
          if (query.includes('Blinding')) return clientJson([PERFECT_CANDIDATE]);
          return clientJson([
            { videoId: 'zzzzzzzzzzz', title: 'Totally Different', artists: [{ name: 'Nobody' }], duration: '1:40', duration_seconds: 100 },
          ]);
        }
        throw new Error(`unexpected api path ${url.pathname}`);
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const progress: { done: number; total: number; result: TrackConversion }[] = [];
    const results = await convertImportSource(
      `https://open.spotify.com/playlist/${ID}`,
      (event) => progress.push(event),
    );
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ status: 'matched', confidence: 1 });
    expect(results[0]?.match).toMatchObject({ videoId: 'J7p4bzqLvCw' });
    expect(results[0]?.source.id).toBe('sp1');
    expect(results[1]).toMatchObject({ status: 'not_found', match: null });
    expect(results[1]?.source.id).toBe('sp2');
    expect(progress.map((event) => event.done)).toEqual([1, 2]);
    const searchCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/search'));
    expect(String(searchCall?.[0])).toContain('filter=songs');
    expect(String(searchCall?.[0])).toContain('limit=15');
  });

  it('emits YouTube sources as matched at 1.0 without searching', async () => {
    let searchCalls = 0;
    vi.stubGlobal(
      'fetch',
      routeFetch({
        probe: 'html',
        api: (url) => {
          if (url.pathname === '/search') {
            searchCalls += 1;
            return clientJson([]);
          }
          if (url.pathname.startsWith('/playlists/')) {
            return clientJson({
              title: 'YT Mix',
              author: { name: 'Chan' },
              trackCount: 1,
              thumbnails: [],
              tracks: [
                {
                  videoId: 'aaaaaaaaaaa',
                  title: 'Song A',
                  artists: [{ name: 'Art A' }],
                  album: null,
                  duration: '3:00',
                  duration_seconds: 180,
                  thumbnails: [],
                  isExplicit: false,
                },
              ],
            });
          }
          throw new Error(`unexpected api path ${url.pathname}`);
        },
      }),
    );
    const results = await convertImportSource(
      'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf',
      () => {},
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: 'matched', confidence: 1 });
    expect(results[0]?.match).toMatchObject({ videoId: 'aaaaaaaaaaa' });
    expect(searchCalls).toBe(0);
  });

  it('turns a per-track search failure into an error conversion path, not a blown conversion', async () => {
    // matchTrack swallows per-query search errors (server parity), so a
    // dead search yields not_found conversions and a completed run.
    vi.stubGlobal(
      'fetch',
      routeFetch({
        probe: 'html',
        helper: () => clientJson(HELPER_PAYLOAD),
        api: () => {
          throw new Error('search exploded');
        },
      }),
    );
    const results = await convertImportSource(`https://open.spotify.com/playlist/${ID}`, () => {});
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.status === 'not_found')).toBe(true);
  });

  it('respects the AbortSignal between tracks', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({
        probe: 'html',
        helper: () => clientJson(HELPER_PAYLOAD),
        api: (url) => {
          if (url.pathname === '/search') return clientJson([PERFECT_CANDIDATE]);
          throw new Error(`unexpected api path ${url.pathname}`);
        },
      }),
    );
    const controller = new AbortController();
    await expect(
      convertImportSource(
        `https://open.spotify.com/playlist/${ID}`,
        () => controller.abort(),
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
