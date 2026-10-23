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
import { ApiError, apiBase, apiGet } from '../api';
import { addTrackToPlaylist, createPlaylist } from '../db/repos/playlists';
import type { Track } from '../types/models';
import { normalizeTrack } from '../utils/track';

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
const SHARE_CODE_RE = /^pl_[A-Za-z0-9_-]+$/;
const SHARE_PARAM_RE = /[?&]pl=(pl_[A-Za-z0-9_-]+)/;
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
  if (SHARE_CODE_RE.test(text)) return { kind: 'carmen-share', id: text };
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
  if (pl && SHARE_CODE_RE.test(pl)) return { kind: 'carmen-share', id: pl };

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

/* ── resolve (preview) ──────────────────────────────────────────────── */

/**
 * Resolve any supported link into a preview: source metadata plus the
 * source track list (no conversion yet).
 *
 * Carmen share links resolve through the share registry (the preview is
 * the shared playlist itself); every other kind goes to
 * `GET /convert/resolve`.
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

  const payload = await apiGet('/convert/resolve', { url }, signal);
  const rawSource = (payload?.source ?? payload?.playlist ?? payload ?? {}) as Record<
    string,
    unknown
  >;
  const kind = asImportKind(rawSource.kind) ?? detected.kind;
  const rawTracks = (payload?.tracks ?? rawSource.tracks ?? []) as unknown[];
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
  const outcome = await streamUniversalConvert(url, onProgress, signal, limit, detected.kind);
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
  const outcome = await streamUniversalConvert(url, onProgress, signal, limit, 'spotify-playlist');
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

  if (status === 0) return 'Cannot reach the server — is it running?';
  // The server's Apple-playlist rejection is already precise and
  // actionable ("Apple Music playlists can't be imported — …"), so it is
  // surfaced verbatim instead of being mapped onto a generic message.
  if (/apple/i.test(message) && /playlist/i.test(message) && /(can\u2019t|cannot|can not|not supported|developer token)/i.test(message)) {
    return message;
  }
  if (status === 404 && /\/convert\//.test(message)) {
    return 'This Carmen server is too old for Spotify import — update the server and try again.';
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
