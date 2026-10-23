/**
 * Unit tests for the universal import client helpers.
 *
 * Covers the pure functions (link parsing / detection, error mapping) —
 * the network calls and the SSE stream are exercised against a stubbed
 * `fetch` (the resolve preview mapping and the conversion stream's
 * `source` field handling included).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api';
import {
  convertImportSource,
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
      /too old for Spotify import/,
    );
  });

  it('explains a missing/private playlist on other 404s', () => {
    expect(friendlyConvertError(404, 'Not Found')).toMatch(/private/);
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
    expect(friendlyConvertError(new ApiError('Not Found', 404, null))).toMatch(/private/);
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

  it('refuses Carmen share links — they import directly, never convert', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(convertImportSource(SHARE_CODE, () => {})).rejects.toThrow(/imports directly/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
