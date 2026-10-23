/**
 * Universal import client (generalised from the Spotify-only converter).
 *
 * The heavy lifting (talking to Spotify / Apple / YouTube, scoring
 * YouTube Music candidates) lives on the FastAPI backend
 * (`server/routes/convert.py`); this module is the typed, abortable
 * client for it, plus the "save the conversion into the local library"
 * step that reuses the app's own playlist repos.
 *
 * Sources understood by `detectImportLink`:
 *   Spotify playlist / album / track / artist, Apple Music album /
 *   playlist, YouTube (Music) video / playlist, and Carmen share links
 *   (`?pl=pl_…`) or bare share codes (`pl_…`). Carmen shares are not
 *   converted — they resolve through `services/playlistShare` instead.
 */
import { ApiError, apiBase, apiGet, isOutdatedServerMessage, serverOutdatedMessage } from '../api';
import { addTrackToPlaylist, createPlaylist } from '../db/repos/playlists';
import { matchTrack, parseDurationSeconds, ytmArtistNames } from './matching';
import type { Track } from '../types/models';
import { normalizeTrack } from '../utils/track';

/**
 * Mirrors `server/importing.py`'s `APPLE_PLAYLIST_MESSAGE` verbatim — the
 * precise rejection Apple Music playlist links get, server or no server.
 */
export const APPLE_PLAYLIST_MESSAGE =
  'Apple Music playlists can\u2019t be read without an Apple developer token \u2014 ' +
  'Carmen doesn\u2019t have one. Import an Apple Music album link instead, or ' +
  'use a Spotify or YouTube link for this playlist.';

/* ── source kinds ─────────────────────────────────────────────────────── */

export type ImportKind =
  | 'spotify-playlist'
  | 'spotify-album'
  | 'spotify-track'
  | 'spotify-artist'
  | 'apple-album'
  | 'apple-playlist'
  | 'youtube-video'
  | 'youtube-playlist'
  | 'carmen-share';

const IMPORT_KINDS: readonly ImportKind[] = [
  'spotify-playlist',
  'spotify-album',
  'spotify-track',
  'spotify-artist',
  'apple-album',
  'apple-playlist',
  'youtube-video',
  'youtube-playlist',
  'carmen-share',
];

function asImportKind(value: unknown): ImportKind | null {
  return typeof value === 'string' && (IMPORT_KINDS as readonly string[]).includes(value)
    ? (value as ImportKind)
    : null;
}

/** Coarse origin family of a kind (`spotify`, `apple`, `youtube`, `carmen`). */
export function importFamily(kind: ImportKind): string {
  return kind.split('-')[0] ?? kind;
}

/* ── link detection (client-side validation mirrors the server) ─────── */

const SPOTIFY_ID = '[A-Za-z0-9]{22}';
const PLAYLIST_URL_RE =
  /^(?:https?:\/\/)?open\.spotify\.com\/(?:intl-[a-z-]+\/)?playlist\/([A-Za-z0-9]{22})(?:[?#/].*)?$/i;
const PLAYLIST_URI_RE = /^spotify:playlist:([A-Za-z0-9]{22})$/i;
const BARE_ID_RE = /^([A-Za-z0-9]{22})$/;
const SPOTIFY_URL_RE = new RegExp(
  `^(?:https?:\/\/)?open\\.spotify\\.com\\/(?:intl-[a-z-]+\\/)?(playlist|album|track|artist)\\/(${SPOTIFY_ID})(?:[?#/].*)?$`,
  'i',
);
const SPOTIFY_URI_RE = new RegExp(
  `^spotify:(playlist|album|track|artist):(${SPOTIFY_ID})$`,
  'i',
);
const ANY_SHARE_CODE_RE = /^(?:plz_|pl_)[A-Za-z0-9_-]+$/;
const SHARE_PARAM_RE = /[?&]pl=(plz_[A-Za-z0-9_-]+|pl_[A-Za-z0-9_-]+)/;
const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{6,}$/;

export interface DetectedImportLink {
  kind: ImportKind;
  id: string;
}

/**
 * Classify a pasted import link / URI / code.
 *
 * Returns the source `kind` and the source-native `id` (Spotify id,
 * Apple catalogue id, YouTube video/playlist id, Carmen `pl_…` code), or
 * `null` when the input is not a recognised source — the dialog shows a
 * hint instead of firing a doomed request.
 */
export function detectImportLink(input: string): DetectedImportLink | null {
  const text = (input || '').trim();
  if (!text) return null;

  // Carmen share: bare code first, then any URL carrying `?pl=`.
  // Both registry codes (`pl_…`) and self-contained payload tokens
  // (`plz_…`) classify here — `plz_` never matches the `pl_` patterns.
  if (ANY_SHARE_CODE_RE.test(text)) return { kind: 'carmen-share', id: text };
  const shareParam = SHARE_PARAM_RE.exec(text);
  if (shareParam?.[1]) return { kind: 'carmen-share', id: shareParam[1] };

  // Spotify URIs and URLs (scheme optional, `intl-xx` prefix tolerated).
  const spotifyUri = SPOTIFY_URI_RE.exec(text);
  if (spotifyUri?.[1] && spotifyUri[2]) {
    return { kind: `spotify-${spotifyUri[1].toLowerCase()}` as ImportKind, id: spotifyUri[2] };
  }
  const spotifyUrl = SPOTIFY_URL_RE.exec(text);
  if (spotifyUrl?.[1] && spotifyUrl[2]) {
    return { kind: `spotify-${spotifyUrl[1].toLowerCase()}` as ImportKind, id: spotifyUrl[2] };
  }
  // A bare 22-char id is a Spotify playlist (the historical paste shape).
  const bare = BARE_ID_RE.exec(text);
  if (bare?.[1]) return { kind: 'spotify-playlist', id: bare[1] };

  // Everything else needs real URL parsing (scheme added when omitted).
  let url: URL | null = null;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();

  // A Carmen URL parsed properly (the `pl` param may not be the first).
  const pl = url.searchParams.get('pl');
  if (pl && ANY_SHARE_CODE_RE.test(pl)) return { kind: 'carmen-share', id: pl };

  // Apple Music: …/album/<slug>/<catalogue id>, …/playlist/<slug>/pl.…
  if (host === 'music.apple.com' || host === 'itunes.apple.com') {
    const segments = url.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1] ?? '';
    if (segments.includes('album') && /^\d+$/.test(last)) {
      return { kind: 'apple-album', id: last };
    }
    if (segments.includes('playlist') && last.startsWith('pl.')) {
      return { kind: 'apple-playlist', id: last };
    }
    return null;
  }

  // YouTube / YouTube Music: watch + youtu.be are videos, /playlist is not.
  if (
    host === 'youtu.be' ||
    host.endsWith('.youtube.com') ||
    host === 'youtube.com' ||
    host === 'www.youtube.com' ||
    host === 'music.youtube.com'
  ) {
    const segments = url.pathname.split('/').filter(Boolean);
    if (host === 'youtu.be') {
      const id = segments[0] ?? '';
      return YOUTUBE_VIDEO_ID_RE.test(id) ? { kind: 'youtube-video', id } : null;
    }
    if (segments[0] === 'watch') {
      const videoId = url.searchParams.get('v') ?? '';
      if (YOUTUBE_VIDEO_ID_RE.test(videoId)) return { kind: 'youtube-video', id: videoId };
      const list = url.searchParams.get('list') ?? '';
      return YOUTUBE_PLAYLIST_ID_RE.test(list) ? { kind: 'youtube-playlist', id: list } : null;
    }
    if (segments[0] === 'playlist') {
      const list = url.searchParams.get('list') ?? '';
      return YOUTUBE_PLAYLIST_ID_RE.test(list) ? { kind: 'youtube-playlist', id: list } : null;
    }
    if (
      (segments[0] === 'shorts' || segments[0] === 'embed' || segments[0] === 'live') &&
      segments[1] &&
      YOUTUBE_VIDEO_ID_RE.test(segments[1])
    ) {
      return { kind: 'youtube-video', id: segments[1] };
    }
    return null;
  }

  return null;
}

/**
 * Extract the Spotify playlist id from a pasted link / URI / bare id.
 * Returns `null` when the input is not recognizable (the dialog shows a
 * hint instead of firing a doomed request).
 *
 * Kept with its original behaviour for existing callers; new code should
 * use `detectImportLink`, which covers every source kind.
 */
export function parseSpotifyPlaylistUrl(input: string): string | null {
  const text = (input || '').trim();
  if (!text) return null;
  for (const pattern of [PLAYLIST_URI_RE, PLAYLIST_URL_RE, BARE_ID_RE]) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1];
  }
  return null;
}

/* ── backend payloads ─────────────────────────────────────────────────── */

export interface SourceTrackInfo {
  id: string;
  title: string;
  artists: string[];
  artist: string;
  album: string | null;
  artwork: string | null;
  duration_ms: number | null;
  url: string;
  explicit: boolean;
  /**
   * Origin of the track: the `ImportKind` it was read from when known
   * (e.g. `spotify-playlist`), otherwise the origin family string
   * (`spotify`, `apple`, `youtube`, `carmen`).
   */
  source: string;
  /** Legacy alias of `url`, kept for Spotify-shaped consumers. */
  spotify_url?: string;
}

/** Back-compat alias — the universal source track shape. */
export type SpotifyTrackInfo = SourceTrackInfo;

export interface SpotifyPlaylistInfo {
  id: string;
  name: string;
  description: string;
  owner: string;
  artwork: string | null;
  spotify_url: string;
  track_count: number;
  tracks: SourceTrackInfo[];
}

export interface ImportSourceInfo {
  kind: ImportKind;
  id: string;
  name: string;
  owner: string;
  artwork: string | null;
  url: string;
  trackCount: number;
  description?: string | null;
}

export interface ImportPreview {
  source: ImportSourceInfo;
  tracks: SourceTrackInfo[];
}

export type MatchStatus = 'matched' | 'approximate' | 'not_found' | 'error';

export interface TrackConversion {
  source: SourceTrackInfo;
  /** @deprecated Legacy field name of `source` (pre-universal payloads). */
  spotify?: SourceTrackInfo;
  status: MatchStatus;
  /** 0–1 score of the winning YouTube Music candidate. */
  confidence: number;
  /** Raw YouTube Music item (same shape as `/search` results) or null. */
  match: Record<string, unknown> | null;
  error: string | null;
}

export interface ConversionSummary {
  total: number;
  matched: number;
  approximate: number;
  not_found: number;
  error: number;
}

/* ── payload normalization ────────────────────────────────────────────── */

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

/**
 * Coerce one raw source-track payload (any source family, camelCase or
 * snake_case) into `SourceTrackInfo`. `fallbackKind` stamps the `source`
 * field when the payload does not carry one itself.
 */
function normalizeSourceTrack(raw: unknown, fallbackKind?: ImportKind | null): SourceTrackInfo {
  const record = (raw ?? {}) as Record<string, unknown>;
  const artists = (Array.isArray(record.artists) ? record.artists : [])
    .map((entry) =>
      typeof entry === 'string' ? entry : ((entry as { name?: unknown })?.name as string),
    )
    .filter((name): name is string => typeof name === 'string' && Boolean(name));
  const artist =
    firstString(record.artist) ?? (artists.length ? artists.join(', ') : '');
  const albumRaw = record.album;
  const album =
    typeof albumRaw === 'string'
      ? albumRaw
      : albumRaw && typeof albumRaw === 'object'
        ? firstString((albumRaw as { name?: unknown }).name)
        : null;
  const thumbnails = Array.isArray(record.thumbnails)
    ? (record.thumbnails as { url?: unknown }[])
    : [];
  const artwork =
    firstString(record.artwork) ??
    firstString(...thumbnails.map((thumb) => thumb?.url).reverse());
  const url =
    firstString(record.url, record.spotify_url, record.apple_url, record.youtube_url) ?? '';
  const durationMs =
    typeof record.duration_ms === 'number'
      ? record.duration_ms
      : typeof record.duration_seconds === 'number'
        ? record.duration_seconds * 1000
        : null;
  const sourceField = firstString(record.source) ?? (fallbackKind ?? '');
  const track: SourceTrackInfo = {
    id: firstString(record.id, record.videoId) ?? '',
    title: firstString(record.title) ?? 'Unknown title',
    artists,
    artist,
    album,
    artwork,
    duration_ms: durationMs,
    url,
    explicit: Boolean(record.explicit ?? record.isExplicit),
    source: sourceField,
  };
  if (url && (sourceField.startsWith('spotify') || firstString(record.spotify_url))) {
    track.spotify_url = firstString(record.spotify_url) ?? url;
  }
  return track;
}

/** One conversion result, tolerating the legacy `spotify` field name. */
function normalizeConversion(raw: unknown, fallbackKind?: ImportKind | null): TrackConversion {
  const record = (raw ?? {}) as Record<string, unknown>;
  const source = normalizeSourceTrack(record.source ?? record.spotify, fallbackKind);
  const status = firstString(record.status);
  return {
    source,
    spotify: source,
    status: (status === 'matched' || status === 'approximate' || status === 'not_found' || status === 'error'
      ? status
      : 'error') as MatchStatus,
    confidence: typeof record.confidence === 'number' ? record.confidence : 0,
    match:
      record.match && typeof record.match === 'object'
        ? (record.match as Record<string, unknown>)
        : null,
    error: firstString(record.error),
  };
}

/** A library `Track` re-expressed as a source track (Carmen shares). */
function trackToSourceTrack(track: Track): SourceTrackInfo {
  const artists = track.artists
    .map((entry) => (typeof entry === 'string' ? entry : entry?.name))
    .filter((name): name is string => typeof name === 'string' && Boolean(name));
  return {
    id: track.videoId,
    title: track.title,
    artists,
    artist: track.artist,
    album: track.albumName || null,
    artwork: track.artwork,
    duration_ms: track.durationSeconds != null ? track.durationSeconds * 1000 : null,
    url: '',
    explicit: track.isExplicit,
    source: 'carmen-share',
  };
}

/* ── server capability probe ──────────────────────────────────────────── */

let convertProbe: Promise<boolean> | null = null;

/** Test hook: forget the cached probe result (production code never calls this). */
export function __resetConvertProbeForTests(): void {
  convertProbe = null;
}

/**
 * Whether the configured server exposes the universal import endpoints,
 * probed once per session with one lightweight GET to
 * `${apiBase()}/convert/resolve`: a JSON answer (any status — a junk-url
 * probe earns a 400/422 JSON on a real server, which still proves the
 * routes exist) means available; the outdated server's SPA fallback
 * (HTTP 200 HTML, unparseable as JSON) or a network failure means the
 * client-driven path must be used instead.
 */
export function convertServerAvailable(): Promise<boolean> {
  if (!convertProbe) {
    convertProbe = (async () => {
      try {
        const response = await fetch(
          `${apiBase()}/convert/resolve?url=${encodeURIComponent('__carmen_probe__')}`,
        );
        if (typeof response.text === 'function') {
          const text = await response.text();
          try {
            JSON.parse(text);
            return true;
          } catch {
            return false;
          }
        }
        await response.json();
        return true;
      } catch {
        return false;
      }
    })();
    convertProbe.catch(() => {
      convertProbe = null;
    });
  }
  return convertProbe;
}

/* ── resolve (preview) ──────────────────────────────────────────────── */

/** Normalize a raw resolve payload (server, helper or client-built) into a preview. */
function previewFromPayload(
  payload: unknown,
  detected: DetectedImportLink,
  url: string,
): ImportPreview {
  const record = (payload ?? {}) as Record<string, unknown>;
  const rawSource = (record.source ?? record.playlist ?? record ?? {}) as Record<string, unknown>;
  const kind = asImportKind(rawSource.kind) ?? detected.kind;
  const rawTracks = (record.tracks ?? rawSource.tracks ?? []) as unknown[];
  const tracks = (Array.isArray(rawTracks) ? rawTracks : []).map((track) =>
    normalizeSourceTrack(track, kind),
  );
  const trackCountRaw = rawSource.trackCount ?? rawSource.track_count;
  return {
    source: {
      kind,
      id: firstString(rawSource.id) ?? detected.id,
      name: firstString(rawSource.name) ?? '',
      owner: firstString(rawSource.owner, rawSource.artist) ?? '',
      artwork: firstString(rawSource.artwork),
      url: firstString(rawSource.url, rawSource.spotify_url) ?? url,
      trackCount: typeof trackCountRaw === 'number' ? trackCountRaw : tracks.length,
      description: firstString(rawSource.description),
    },
    tracks,
  };
}

/** The server resolve path (Worker A's outdated detection intact). */
async function resolveViaServer(
  url: string,
  detected: DetectedImportLink,
  signal?: AbortSignal,
): Promise<ImportPreview> {
  const payload = await apiGet('/convert/resolve', { url }, signal);
  // An outdated server has no /convert/* routes: its SPA catch-all
  // answers the GET with index.html (HTTP 200), which `apiGet` parses as
  // `null` — and any other answer carrying none of the recognised
  // preview keys is not a preview either. Never fabricate an empty
  // "0 songs" preview from that; say plainly that the server is old.
  if (
    !payload ||
    typeof payload !== 'object' ||
    (!('source' in payload) && !('playlist' in payload) && !('tracks' in payload))
  ) {
    throw new ApiError(serverOutdatedMessage('Playlist import'), 404, payload ?? null);
  }
  return previewFromPayload(payload, detected, url);
}

/* ── client-side resolve (no Carmen server endpoints needed) ──────────── */

interface ClientResolved {
  preview: ImportPreview;
  /** Raw YouTube Music items aligned with `preview.tracks` (YouTube kinds only). */
  rawTracks: (Record<string, unknown> | null)[];
}

function outdatedImportError(): ApiError {
  return new ApiError(serverOutdatedMessage('Playlist import'), 404, null);
}

/** Spotify kinds resolve through the same-origin Vercel helper (`api/resolve.py`). */
async function resolveViaHelper(
  url: string,
  detected: DetectedImportLink,
  signal?: AbortSignal,
): Promise<ClientResolved> {
  const origin = typeof window !== 'undefined' ? window.location?.origin : undefined;
  if (!origin || !/^https?:\/\//i.test(origin)) throw outdatedImportError();
  let response: Response;
  try {
    response = await fetch(`${origin}/api/resolve?url=${encodeURIComponent(url)}`, { signal });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw outdatedImportError();
  }
  let payload: unknown = null;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const record = (payload ?? {}) as Record<string, unknown>;
    const detail = firstString(record.detail, record.error);
    throw new ApiError(
      detail ? friendlyConvertError(response.status, detail) : serverOutdatedMessage('Playlist import'),
      response.status,
      payload,
    );
  }
  if (
    !payload ||
    typeof payload !== 'object' ||
    (!('source' in payload) && !('tracks' in payload))
  ) {
    throw outdatedImportError();
  }
  const preview = previewFromPayload(payload, detected, url);
  return { preview, rawTracks: preview.tracks.map(() => null) };
}

function upgradeItunesArtwork(value: unknown): string | null {
  const url = firstString(value);
  return url ? url.replace('100x100bb', '600x600bb') : null;
}

/** Apple albums resolve client-side via the public iTunes Lookup API (CORS *). */
async function resolveAppleAlbumClient(
  url: string,
  detected: DetectedImportLink,
  signal?: AbortSignal,
): Promise<ClientResolved> {
  let response: Response;
  try {
    response = await fetch(
      `https://itunes.apple.com/lookup?id=${encodeURIComponent(detected.id)}&entity=song`,
      { signal },
    );
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new ApiError('Could not reach Apple Music — please try again.', 502, null);
  }
  if (response.status === 404) {
    throw new ApiError('Apple Music couldn\u2019t find that album.', 404, null);
  }
  if (!response.ok) {
    throw new ApiError(`Apple Music lookup failed (HTTP ${response.status}).`, 502, null);
  }
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) throw new ApiError('Apple Music returned an unreadable answer.', 502, null);
  const results = Array.isArray(payload.results) ? payload.results : [];
  const collection = (results[0] ?? null) as Record<string, unknown> | null;
  if (!collection || typeof collection !== 'object') {
    throw new ApiError(
      'Apple Music couldn\u2019t find that album — the link may be wrong or the album isn\u2019t available in the US storefront.',
      404,
      null,
    );
  }
  const albumName = firstString(collection.collectionName) ?? 'Apple Music album';
  const albumArtist = firstString(collection.artistName) ?? '';
  const albumArtwork = upgradeItunesArtwork(collection.artworkUrl100);
  const items = results
    .slice(1)
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object' && (item as any).wrapperType === 'track',
    )
    .sort((a, b) => {
      const disc = (typeof a.discNumber === 'number' ? a.discNumber : 1) -
        (typeof b.discNumber === 'number' ? b.discNumber : 1);
      if (disc !== 0) return disc;
      return (typeof a.trackNumber === 'number' ? a.trackNumber : 0) -
        (typeof b.trackNumber === 'number' ? b.trackNumber : 0);
    });
  const tracks: Record<string, unknown>[] = [];
  for (const item of items) {
    const title = firstString(item.trackName);
    if (!title || item.trackId === undefined || item.trackId === null) continue;
    const artistName = firstString(item.artistName) ?? albumArtist;
    tracks.push({
      id: String(item.trackId),
      title,
      artists: artistName ? [artistName] : [],
      artist: artistName || 'Unknown artist',
      album: firstString(item.collectionName) ?? albumName,
      artwork: upgradeItunesArtwork(item.artworkUrl100) ?? albumArtwork,
      duration_ms: typeof item.trackTimeMillis === 'number' ? item.trackTimeMillis : null,
      url: firstString(item.trackViewUrl, collection.collectionViewUrl) ?? '',
      explicit: item.trackExplicitness === 'explicit',
      isrc: null,
    });
  }
  const source = {
    kind: 'apple-album',
    id: String(collection.collectionId ?? detected.id),
    name: albumName,
    owner: albumArtist,
    artwork: albumArtwork,
    url:
      firstString(collection.collectionViewUrl) ??
      `https://music.apple.com/us/album/${detected.id}`,
    track_count: tracks.length,
  };
  const preview = previewFromPayload({ source, tracks }, detected, url);
  return { preview, rawTracks: preview.tracks.map(() => null) };
}

/* YouTube Music item → common-shape track (mirrors server/importing.py). */

function ytmAlbumNameRaw(item: Record<string, unknown>): string | null {
  const album = item.album;
  if (typeof album === 'string' && album.trim()) return album.trim();
  if (album && typeof album === 'object') return firstString((album as any).name);
  return null;
}

function ytmArtworkRaw(item: Record<string, unknown>): string | null {
  if (typeof item.artwork === 'string' && item.artwork) return item.artwork;
  const lists = [item.thumbnails, item.thumbnail];
  let best: string | null = null;
  let bestArea = -1;
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const thumb of list) {
      if (!thumb || typeof thumb !== 'object' || typeof (thumb as any).url !== 'string') continue;
      const area = ((thumb as any).width || 0) * ((thumb as any).height || 0);
      if (area > bestArea) {
        bestArea = area;
        best = (thumb as any).url;
      }
    }
  }
  if (best) return best;
  return typeof item.thumbnail === 'string' && item.thumbnail ? item.thumbnail : null;
}

function ytmDurationMsRaw(item: Record<string, unknown>): number | null {
  // Same key order as server/filters._DURATION_KEYS.
  for (const key of ['duration_seconds', 'duration', 'length_seconds', 'length', 'lengthSeconds']) {
    const seconds = parseDurationSeconds(item[key]);
    if (seconds !== null) return seconds * 1000;
  }
  return null;
}

function ytmTrackPair(
  item: Record<string, unknown>,
): { common: Record<string, unknown>; raw: Record<string, unknown> } | null {
  const videoId = typeof item.videoId === 'string' ? item.videoId : '';
  const title = typeof item.title === 'string' ? item.title.trim() : '';
  if (!videoId || !title) return null;
  const artists = ytmArtistNames(item);
  const thumbnails = Array.isArray(item.thumbnails)
    ? item.thumbnails
    : Array.isArray(item.thumbnail)
      ? item.thumbnail
      : [];
  const common: Record<string, unknown> = {
    id: videoId,
    title,
    artists,
    artist: artists.length ? artists.join(', ') : 'Unknown artist',
    album: ytmAlbumNameRaw(item),
    artwork: ytmArtworkRaw(item),
    duration_ms: ytmDurationMsRaw(item),
    url: `https://music.youtube.com/watch?v=${videoId}`,
    explicit: Boolean(item.isExplicit),
    isrc: null,
    videoId,
    thumbnails,
  };
  return { common, raw: item };
}

function ytmOwnerRaw(data: Record<string, unknown>): string {
  const author = data.author;
  if (author && typeof author === 'object') return firstString((author as any).name) ?? '';
  return typeof author === 'string' ? author : '';
}

/** YouTube playlists resolve through the configured API's own `/playlists/{id}`. */
async function resolveYoutubePlaylistClient(
  url: string,
  detected: DetectedImportLink,
  signal?: AbortSignal,
): Promise<ClientResolved> {
  const payload = await apiGet(`/playlists/${encodeURIComponent(detected.id)}`, { limit: 500 }, signal);
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.tracks)) {
    throw new ApiError('YouTube Music couldn\u2019t find that playlist.', 404, payload ?? null);
  }
  const pairs = (payload.tracks as unknown[])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map(ytmTrackPair)
    .filter((pair): pair is NonNullable<typeof pair> => pair !== null);
  const source = {
    kind: 'youtube-playlist',
    id: detected.id,
    name: firstString(payload.title) ?? 'YouTube Music playlist',
    owner: ytmOwnerRaw(payload),
    artwork: ytmArtworkRaw(payload),
    url: `https://music.youtube.com/playlist?list=${detected.id}`,
    track_count: typeof payload.trackCount === 'number' ? payload.trackCount : pairs.length,
  };
  const preview = previewFromPayload({ source, tracks: pairs.map((pair) => pair.common) }, detected, url);
  return { preview, rawTracks: pairs.map((pair) => pair.raw) };
}

/** A YouTube video resolves through `/browsing/track/{id}` (falling back to `/watch`). */
async function resolveYoutubeVideoClient(
  url: string,
  detected: DetectedImportLink,
  signal?: AbortSignal,
): Promise<ClientResolved> {
  let raw: Record<string, unknown> | null = null;
  try {
    const payload = await apiGet(`/browsing/track/${encodeURIComponent(detected.id)}`, {}, signal);
    if (payload && typeof payload === 'object' && typeof payload.videoId === 'string') {
      raw = payload as Record<string, unknown>;
    }
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    raw = null; // fall through to the watch route
  }
  if (!raw) {
    const watch = await apiGet('/watch', { videoId: detected.id, limit: 1 }, signal);
    const items = Array.isArray(watch?.tracks) ? watch.tracks : [];
    raw =
      (items.find(
        (item: any) => item && typeof item === 'object' && item.videoId === detected.id,
      ) as Record<string, unknown> | undefined) ??
      (items[0] as Record<string, unknown> | undefined) ??
      null;
  }
  const pair = raw ? ytmTrackPair(raw) : null;
  if (!pair) {
    throw new ApiError('YouTube Music couldn\u2019t find that video.', 404, null);
  }
  const source = {
    kind: 'youtube-video',
    id: detected.id,
    name: String(pair.common.title),
    owner: String(pair.common.artist),
    artwork: (pair.common.artwork as string | null) ?? null,
    url: String(pair.common.url),
    track_count: 1,
  };
  const preview = previewFromPayload({ source, tracks: [pair.common] }, detected, url);
  return { preview, rawTracks: [pair.raw] };
}

/** Client-driven resolve dispatch (the probe said the server has no /convert/*). */
async function resolveClientSide(
  url: string,
  detected: DetectedImportLink,
  signal?: AbortSignal,
): Promise<ClientResolved> {
  switch (detected.kind) {
    case 'spotify-playlist':
    case 'spotify-album':
    case 'spotify-track':
    case 'spotify-artist':
      return resolveViaHelper(url, detected, signal);
    case 'apple-album':
      return resolveAppleAlbumClient(url, detected, signal);
    case 'apple-playlist':
      throw new ApiError(APPLE_PLAYLIST_MESSAGE, 400, null);
    case 'youtube-playlist':
      return resolveYoutubePlaylistClient(url, detected, signal);
    case 'youtube-video':
      return resolveYoutubeVideoClient(url, detected, signal);
    default:
      throw outdatedImportError();
  }
}

/**
 * Resolve any supported link into a preview: source metadata plus the
 * source track list (no conversion yet).
 *
 * Carmen share links resolve through the share registry (the preview is
 * the shared playlist itself). Every other kind uses
 * `GET /convert/resolve` when the configured server exposes it (probed
 * once per session) and otherwise resolves client-side: Spotify via the
 * same-origin `/api/resolve` helper, Apple albums via iTunes Lookup,
 * YouTube via the API's own playlist/track routes.
 */
export async function resolveImportSource(
  url: string,
  signal?: AbortSignal,
): Promise<ImportPreview> {
  const detected = detectImportLink(url);
  if (!detected) {
    throw new ApiError(
      'That doesn\u2019t look like a supported link \u2014 paste a Spotify, Apple Music, YouTube or Carmen share link.',
      400,
      null,
    );
  }

  if (detected.kind === 'carmen-share') {
    // Dynamic import: playlistShare imports the api/repos layer too, and
    // shares are the rare path — keep it out of the static cycle.
    const { resolveSharedPlaylist } = await import('./playlistShare');
    const shared = await resolveSharedPlaylist(url);
    return {
      source: {
        kind: 'carmen-share',
        id: shared.code,
        name: shared.name,
        owner: '',
        artwork: shared.artwork,
        url,
        trackCount: shared.tracks.length,
        description: shared.description,
      },
      tracks: shared.tracks.map(trackToSourceTrack),
    };
  }

  if (await convertServerAvailable()) {
    return resolveViaServer(url, detected, signal);
  }
  const { preview } = await resolveClientSide(url, detected, signal);
  return preview;
}

/** Fetch playlist metadata + the Spotify track list (no conversion yet). */
export async function resolveSpotifyPlaylist(
  url: string,
  signal?: AbortSignal,
): Promise<SpotifyPlaylistInfo> {
  const preview = await resolveImportSource(url, signal);
  return {
    id: preview.source.id,
    name: preview.source.name,
    description: preview.source.description ?? '',
    owner: preview.source.owner,
    artwork: preview.source.artwork,
    spotify_url: preview.source.url,
    track_count: preview.source.trackCount,
    tracks: preview.tracks,
  };
}

/* ── convert (server-sent events) ───────────────────────────────────── */

export interface ConvertProgress {
  done: number;
  total: number;
  result: TrackConversion;
}

export interface ConvertOutcome {
  results: TrackConversion[];
  summary: ConversionSummary;
  playlist: { id: string; name: string; owner: string; artwork: string | null };
}

interface UniversalOutcome {
  results: TrackConversion[];
  summary: ConversionSummary;
  source: { id: string; name: string; owner: string; artwork: string | null };
}

/**
 * Stream `POST /convert/to-ytmusic` as server-sent events, calling
 * `onProgress` for every converted track with the real counts — the
 * dialog renders these directly, so progress is never faked.
 */
function streamUniversalConvert(
  url: string,
  onProgress: (progress: ConvertProgress) => void,
  signal: AbortSignal | undefined,
  limit: number,
  fallbackKind: ImportKind | null,
): Promise<UniversalOutcome> {
  return new Promise<UniversalOutcome>((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    fetch(`${apiBase()}/convert/to-ytmusic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, limit }),
      signal,
    }).then(
      async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          const detail =
            (payload && (payload.detail || payload.message)) ||
            `Request failed (${response.status})`;
          reject(
            new ApiError(
              friendlyConvertError(response.status, String(detail)),
              response.status,
              payload,
            ),
          );
          return;
        }
        // An outdated server answers the unknown POST route's fallback
        // with the SPA's index.html (HTTP 200, text/html) instead of an
        // SSE stream — reject with the outdated message rather than
        // trying (and failing) to parse HTML as events.
        const contentType =
          typeof response.headers?.get === 'function'
            ? (response.headers.get('content-type') ?? '')
            : ((response.headers as unknown as Record<string, string> | undefined)?.[
                'content-type'
              ] ?? '');
        if (/text\/html/i.test(contentType)) {
          reject(
            new ApiError(serverOutdatedMessage('Playlist import'), response.status, null),
          );
          return;
        }
        const reader = response.body?.getReader();
        if (!reader) {
          reject(new ApiError('The server did not stream the conversion.', 0, null));
          return;
        }
        const decoder = new TextDecoder();
        let buffer = '';
        let outcome: UniversalOutcome | null = null;
        const results: TrackConversion[] = [];
        let source = { id: '', name: '', owner: '', artwork: null as string | null };
        let summary: ConversionSummary = {
          total: 0,
          matched: 0,
          approximate: 0,
          not_found: 0,
          error: 0,
        };

        const handleEvent = (event: string, data: string) => {
          let payload: any = null;
          try {
            payload = JSON.parse(data);
          } catch {
            return;
          }
          if (event === 'start') {
            const info = payload?.source ?? payload?.playlist ?? {};
            source = {
              id: info?.id ?? '',
              name: info?.name ?? '',
              owner: info?.owner ?? '',
              artwork: info?.artwork ?? null,
            };
          } else if (event === 'progress') {
            if (payload?.result) {
              const result = normalizeConversion(payload.result, fallbackKind);
              results.push(result);
              onProgress({
                done: Number(payload?.done ?? results.length),
                total: Number(payload?.total ?? 0),
                result,
              });
            }
          } else if (event === 'done') {
            summary = payload?.summary ?? summary;
            outcome = { results, summary, source };
          }
        };

        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let boundary = buffer.indexOf('\n\n');
            while (boundary >= 0) {
              const chunk = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              let event = '';
              const dataLines: string[] = [];
              for (const line of chunk.split('\n')) {
                if (line.startsWith('event:')) event = line.slice(6).trim();
                else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
              }
              if (event) handleEvent(event, dataLines.join('\n'));
              boundary = buffer.indexOf('\n\n');
            }
          }
        } catch (error) {
          if ((error as Error)?.name === 'AbortError') {
            reject(error);
          } else {
            reject(new ApiError('The conversion stream broke — please try again.', 0, null));
          }
          return;
        } finally {
          reader.releaseLock();
        }

        if (outcome) resolvePromise(outcome);
        else reject(new ApiError('The server closed the conversion without a result.', 0, null));
      },
      (error) => {
        if ((error as Error)?.name === 'AbortError') reject(error);
        else reject(new ApiError('Cannot reach the server', 0, null));
      },
    );
  });
}

/* ── client-driven convert (no /convert/* on the server) ──────────────── */

/** Search the configured API exactly like the server's matcher does. */
function searchViaApi(signal?: AbortSignal) {
  return async (query: string): Promise<unknown[]> => {
    const payload = await apiGet(
      '/search',
      { query, filter: 'songs', limit: 15, ignore_spelling: true },
      signal,
    );
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.results)) return payload.results;
    return [];
  };
}

/**
 * The conversion loop, run in the client: resolve via the client paths,
 * then score every source track against `GET /search` results with the
 * `services/matching` port of `server/matching.py`. Mirrors the server
 * converter's contract — source order preserved, one `onProgress` per
 * track, YouTube sources emitted as matched at confidence 1.0 with no
 * searching, per-track failures as `error` conversions (never a blown
 * conversion), and the AbortSignal honoured between tracks.
 */
async function convertClientSide(
  url: string,
  onProgress: (progress: ConvertProgress) => void,
  signal: AbortSignal | undefined,
  limit: number,
  detected: DetectedImportLink,
): Promise<UniversalOutcome> {
  const { preview, rawTracks } = await resolveClientSide(url, detected, signal);
  const tracks = preview.tracks.slice(0, Math.max(0, limit));
  const total = tracks.length;
  const isYoutube = preview.source.kind.startsWith('youtube-');
  const search = searchViaApi(signal);
  const results: TrackConversion[] = [];
  const counts = { matched: 0, approximate: 0, not_found: 0, error: 0 };

  for (let index = 0; index < tracks.length; index += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const track = tracks[index] as SourceTrackInfo;
    let conversion: TrackConversion;
    if (isYoutube) {
      conversion = {
        source: track,
        spotify: track,
        status: 'matched',
        confidence: 1,
        match: rawTracks[index] ?? null,
        error: null,
      };
    } else {
      try {
        const matched = await matchTrack(track, search);
        conversion = {
          source: track,
          spotify: track,
          status: matched.status,
          confidence: matched.confidence,
          match: matched.match,
          error: matched.error,
        };
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') throw error;
        conversion = {
          source: track,
          spotify: track,
          status: 'error',
          confidence: 0,
          match: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    counts[conversion.status] += 1;
    results.push(conversion);
    onProgress({ done: index + 1, total, result: conversion });
  }

  return {
    results,
    summary: { total, ...counts },
    source: {
      id: preview.source.id,
      name: preview.source.name,
      owner: preview.source.owner,
      artwork: preview.source.artwork,
    },
  };
}

/**
 * Convert through the server's SSE stream when the probe says the
 * endpoints exist; otherwise run the conversion in the client.
 */
async function convertUniversal(
  url: string,
  onProgress: (progress: ConvertProgress) => void,
  signal: AbortSignal | undefined,
  limit: number,
  fallbackKind: ImportKind | null,
  detected: DetectedImportLink,
): Promise<UniversalOutcome> {
  if (await convertServerAvailable()) {
    return streamUniversalConvert(url, onProgress, signal, limit, fallbackKind);
  }
  return convertClientSide(url, onProgress, signal, limit, detected);
}

/**
 * Convert any supported source link to YouTube Music matches.
 *
 * Returns the per-track results in source order. Carmen share links are
 * rejected here on purpose — they import directly through
 * `services/playlistShare` with no conversion step.
 */
export async function convertImportSource(
  url: string,
  onProgress: (progress: ConvertProgress) => void,
  signal?: AbortSignal,
  limit = 100,
): Promise<TrackConversion[]> {
  const detected = detectImportLink(url);
  if (!detected) {
    throw new ApiError(
      'That doesn\u2019t look like a supported link \u2014 paste a Spotify, Apple Music, YouTube or Carmen share link.',
      400,
      null,
    );
  }
  if (detected.kind === 'carmen-share') {
    throw new ApiError(
      'That\u2019s a Carmen share link \u2014 it imports directly, no conversion needed.',
      400,
      null,
    );
  }
  const outcome = await convertUniversal(url, onProgress, signal, limit, detected.kind, detected);
  return outcome.results;
}

/**
 * Convert a Spotify playlist to YouTube Music matches.
 *
 * Thin wrapper over the universal converter, kept for existing callers:
 * same SSE stream, reshaped into the historical outcome object.
 */
export async function convertSpotifyPlaylist(
  url: string,
  onProgress: (progress: ConvertProgress) => void,
  signal?: AbortSignal,
  limit = 100,
): Promise<ConvertOutcome> {
  const detected = detectImportLink(url) ?? { kind: 'spotify-playlist' as ImportKind, id: '' };
  const outcome = await convertUniversal(url, onProgress, signal, limit, 'spotify-playlist', detected);
  return { results: outcome.results, summary: outcome.summary, playlist: outcome.source };
}

/** Human-readable errors for the failure modes the dialog must explain. */
export function friendlyConvertError(statusOrError: number | unknown, detail?: string): string {
  let status = 0;
  let message = '';
  if (typeof statusOrError === 'number') {
    status = statusOrError;
    message = detail ?? '';
  } else if (typeof statusOrError === 'string') {
    message = statusOrError;
  } else if (statusOrError && typeof statusOrError === 'object') {
    const error = statusOrError as { status?: unknown; message?: unknown };
    status = typeof error.status === 'number' ? error.status : 0;
    message = typeof error.message === 'string' ? error.message : '';
    if (detail) message = detail;
  }

  // The outdated-server message is already the precise, user-facing
  // wording — surface it verbatim wherever it was raised.
  if (isOutdatedServerMessage(message)) return message;
  if (status === 0) return 'Cannot reach the server — is it running?';
  // The server's Apple-playlist rejection is already precise and
  // actionable ("Apple Music playlists can't be imported — …"), so it is
  // surfaced verbatim instead of being mapped onto a generic message.
  if (/apple/i.test(message) && /playlist/i.test(message) && /(can\u2019t|cannot|can not|not supported|developer token)/i.test(message)) {
    return message;
  }
  // Outdated server, seen through its framework fallbacks: an unknown
  // POST route answers 405 "Method Not Allowed", and an unknown
  // /convert/* route answers FastAPI's bare 404 "Not Found" (real
  // not-found details from the importer are descriptive sentences —
  // "Spotify couldn't find that item — …" — never the bare words).
  if (status === 405) {
    return serverOutdatedMessage('Playlist import');
  }
  if (
    status === 404 &&
    (/\/convert\//.test(message) || message.trim().toLowerCase() === 'not found')
  ) {
    return serverOutdatedMessage('Playlist import');
  }
  if (status === 404) {
    if (/youtube/i.test(message)) {
      return 'YouTube couldn\u2019t find that \u2014 it may be private, deleted, or the link is wrong.';
    }
    if (/apple/i.test(message)) {
      return 'Apple Music couldn\u2019t find that \u2014 it may have been removed, or the link is wrong.';
    }
    return 'Spotify couldn\u2019t find that playlist — it may be private, deleted, or the link is wrong.';
  }
  if (status === 400) return message || 'That link could not be imported.';
  if (status === 422) return message || 'That link could not be imported.';
  if (status === 429) return 'Too many requests right now — wait a minute and try again.';
  if (status === 503) return 'Spotify is busy right now — try again in a minute.';
  return message || `Conversion failed (${status}).`;
}

/* ── save into the local library ─────────────────────────────────────── */

/** Turn a conversion match into the app's normalized track shape. */
export function conversionToTrack(conversion: TrackConversion): Track | null {
  if (!conversion.match) return null;
  return normalizeTrack(conversion.match);
}

export interface SaveConversionOptions {
  /** Playlist name shown in the library. */
  name: string;
  /** Only these conversions are saved (defaults to every usable match). */
  selected?: TrackConversion[];
  description?: string;
}

/**
 * Create a library playlist from conversion results and add every usable
 * match through the same path the rest of the app uses, so the songs are
 * playable, downloadable and offline-capable like any other track.
 *
 * Returns the new playlist id.
 */
export async function saveConversionAsPlaylist(
  conversions: TrackConversion[],
  options: SaveConversionOptions,
): Promise<number> {
  const selected =
    options.selected ?? conversions.filter((c) => c.match && c.status !== 'not_found');
  const playlistId = await createPlaylist(
    options.name.trim() || 'Imported from Spotify',
    options.description ?? '',
  );
  for (const conversion of selected) {
    const track = conversionToTrack(conversion);
    if (track) {
      await addTrackToPlaylist(playlistId, track);
    }
  }
  return playlistId;
}
