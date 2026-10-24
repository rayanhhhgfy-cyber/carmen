/**
 * Shareable playlists — the client half of the server share registry
 * (`server/routes/shares.py`).
 *
 * A share link carries its code in the **query string** (`?pl=pl_…`) —
 * the hash belongs to HashRouter, so the code never travels in it (see
 * `components/SharedPlaylistGate`, which reads it once at boot). The code
 * is stable per playlist: re-sharing re-POSTs with the code this playlist
 * already has, so the shared copy updates in place and the link never
 * changes. Codes are remembered per playlist id in the app-state store
 * under `playlistShareCodes`.
 */
import { apiBase, apiGet, apiPostJson, serverOutdatedMessage } from '../api';
import { loadAppState, saveAppState } from '../db/repos/appState';
import { addTrackToPlaylist, createPlaylist } from '../db/repos/playlists';
import { isTauri } from '../platform/env';
import type { Playlist, PlaylistSong, Track } from '../types/models';
import { normalizeTrack } from '../utils/track';

/**
 * The public web origin (same pattern as `utils/share.ts`): the Tauri
 * WebView's own origin is meaningless to anyone receiving the link, so
 * shares from the installed app point at the hosted site instead.
 */
const WEB_ORIGIN = 'https://carmen.z44d.com';

const SHARE_CODES_KEY = 'playlistShareCodes';
const SHARE_CODE_RE = /^pl_[A-Za-z0-9_-]+$/;
/** Self-contained payload tokens (`plz_…`) — see the codec below. */
const PAYLOAD_CODE_RE = /^plz_[A-Za-z0-9_-]+$/;
const ANY_SHARE_CODE_RE = /^(?:plz_|pl_)[A-Za-z0-9_-]+$/;
/**
 * Hard cap on a self-contained share URL. Browsers and chat apps start
 * mangling or refusing URLs well before their theoretical limits; 8000
 * characters keeps the link paste-able everywhere while still holding
 * a typical playlist (each track compresses to roughly 60–90 chars).
 */
export const SHARE_PAYLOAD_URL_LIMIT = 8000;

export interface SharedPlaylistPayload {
  code: string;
  name: string;
  description: string | null;
  artwork: string | null;
  tracks: Track[];
  sharedAt?: string;
}

/* ── link build / parse ───────────────────────────────────────────────── */

/** Absolute shareable link of a shared playlist (`https://host/?pl=…`). */
export function buildPlaylistShareUrl(code: string): string {
  const { origin, pathname } = window.location;
  const base = isTauri ? `${WEB_ORIGIN}${pathname}` : `${origin}${pathname}`;
  return `${base}?pl=${encodeURIComponent(code)}`;
}

/**
 * Extract a share code from whatever the user pasted: a full share URL
 * (the `pl` query parameter), or the bare code itself — either a registry
 * code (`pl_…`) or a self-contained payload token (`plz_…`). Returns
 * `null` for anything else. (`plz_` does NOT match the `pl_` patterns —
 * the third character differs — so payload tokens are matched explicitly.)
 */
export function parsePlaylistShareCode(input: string): string | null {
  const text = (input || '').trim();
  if (!text) return null;
  if (ANY_SHARE_CODE_RE.test(text)) return text;
  try {
    const url = new URL(text, window.location.href);
    const pl = url.searchParams.get('pl');
    if (pl && ANY_SHARE_CODE_RE.test(pl)) return pl;
  } catch {
    /* not a URL at all — fall through to the raw scan */
  }
  const match = /[?&]pl=(plz_[A-Za-z0-9_-]+|pl_[A-Za-z0-9_-]+)/.exec(text);
  return match?.[1] ?? null;
}

/* ── stored codes (one stable code per playlist) ──────────────────────── */

type ShareCodeMap = Record<number, string>;

async function loadShareCodes(): Promise<ShareCodeMap> {
  const stored = await loadAppState<ShareCodeMap>(SHARE_CODES_KEY, {});
  return stored && typeof stored === 'object' ? stored : {};
}

/** The share code previously minted for this playlist, if any. */
export async function getStoredShareCode(playlistId: number): Promise<string | null> {
  const codes = await loadShareCodes();
  const code = codes[playlistId];
  return typeof code === 'string' && code ? code : null;
}

async function storeShareCode(playlistId: number, code: string): Promise<void> {
  const codes = await loadShareCodes();
  if (codes[playlistId] === code) return;
  codes[playlistId] = code;
  await saveAppState(SHARE_CODES_KEY, codes);
}

/* ── payload mapping ──────────────────────────────────────────────────── */

/**
 * The plain track shape the registry stores (playback flags stripped).
 *
 * Field types follow the server's `ShareTrack` model: `artists` is a
 * list of names, `album` a plain string and `year` an int — the richer
 * local shapes (artist objects, album object, string year) are flattened
 * here so validation never rejects a share.
 */
function shareableTrack(song: PlaylistSong | Track): Record<string, unknown> {
  const artists = song.artists
    .map((entry) => (typeof entry === 'string' ? entry : entry?.name))
    .filter((name): name is string => typeof name === 'string' && Boolean(name));
  const yearText = song.year ?? song.releaseDate ?? '';
  const yearMatch = /^(\d{4})/.exec(yearText);
  return {
    videoId: song.videoId,
    title: song.title,
    artists,
    artist: song.artist,
    album: song.albumName || null,
    albumName: song.albumName,
    duration: song.duration,
    durationSeconds: song.durationSeconds,
    artwork: song.artwork,
    year: yearMatch?.[1] ? Number(yearMatch[1]) : null,
    releaseDate: song.releaseDate,
    isExplicit: song.isExplicit,
    playlistId: song.playlistId,
  };
}

/** Coerce a registry payload into `SharedPlaylistPayload`. */
function toSharedPayload(payload: any, fallbackCode: string): SharedPlaylistPayload {
  const rawTracks = Array.isArray(payload?.tracks) ? payload.tracks : [];
  const tracks = rawTracks
    .map((raw: unknown) => normalizeTrack(raw))
    .filter((track: Track | null): track is Track => track !== null);
  return {
    code: typeof payload?.code === 'string' && payload.code ? payload.code : fallbackCode,
    name: typeof payload?.name === 'string' && payload.name ? payload.name : 'Shared playlist',
    description: typeof payload?.description === 'string' ? payload.description : null,
    artwork: typeof payload?.artwork === 'string' ? payload.artwork : null,
    tracks,
    sharedAt:
      typeof payload?.sharedAt === 'string'
        ? payload.sharedAt
        : typeof payload?.shared_at === 'string'
          ? payload.shared_at
          : undefined,
  };
}

/* ── self-contained payload codec (no Carmen server needed) ───────────── */

/**
 * When the configured server has no share registry, a playlist can still
 * be shared as a **self-contained link**: the whole payload (name +
 * per-track videoId/title/artists/duration/artwork) is gzip-compressed
 * with the browser-native `CompressionStream`, base64url-encoded and
 * carried in `?pl=` under a `plz_` prefix (registry codes stay `pl_…`).
 * Anyone opening the link decodes it locally — no server round-trip.
 */

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(token: string): Uint8Array {
  const base64 = token.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function gzipText(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipText(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/** The track fields `normalizeTrack` needs to rebuild playable tracks. */
function payloadTrack(song: PlaylistSong | Track): Record<string, unknown> {
  const artists = song.artists
    .map((entry) => (typeof entry === 'string' ? entry : entry?.name))
    .filter((name): name is string => typeof name === 'string' && Boolean(name));
  return {
    videoId: song.videoId,
    title: song.title,
    artists,
    artist: song.artist,
    album: song.albumName || null,
    albumName: song.albumName,
    duration: song.duration,
    durationSeconds: song.durationSeconds,
    duration_seconds: song.durationSeconds,
    artwork: song.artwork,
    isExplicit: song.isExplicit,
  };
}

/**
 * Encode a playlist as a `plz_…` self-contained share token.
 *
 * Throws a clear message when the runtime has no `CompressionStream` —
 * link sharing then needs a newer browser or a Carmen server.
 */
export async function encodeSharePayload(
  playlist: { name: string; description?: string | null; artwork?: string | null },
  songs: (PlaylistSong | Track)[],
): Promise<string> {
  if (typeof CompressionStream === 'undefined') {
    throw new Error(
      'Link sharing needs a newer browser or a Carmen server — this browser cannot compress share links.',
    );
  }
  const payload = {
    v: 1,
    name: playlist.name,
    description: playlist.description ?? null,
    artwork: playlist.artwork ?? null,
    tracks: songs.map(payloadTrack),
  };
  const compressed = await gzipText(JSON.stringify(payload));
  return `plz_${bytesToBase64Url(compressed)}`;
}

/** Decode a `plz_…` token back into a `SharedPlaylistPayload` (no network). */
export async function decodeSharePayload(token: string): Promise<SharedPlaylistPayload> {
  const text = (token || '').trim();
  if (!PAYLOAD_CODE_RE.test(text)) {
    throw new Error('That share link does not carry a playlist payload.');
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new Error(
      'Link sharing needs a newer browser or a Carmen server — this browser cannot read compressed share links.',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await gunzipText(base64UrlToBytes(text.slice('plz_'.length))));
  } catch {
    throw new Error('That share link is damaged — ask for a fresh copy of it.');
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as any).tracks)) {
    throw new Error('That share link is damaged — ask for a fresh copy of it.');
  }
  return toSharedPayload(parsed, text);
}

/* ── registry probe ───────────────────────────────────────────────────── */

let shareRegistryProbe: Promise<boolean> | null = null;

/** Test hook: forget the cached probe result (production code never calls this). */
export function __resetShareRegistryCacheForTests(): void {
  shareRegistryProbe = null;
}

/**
 * Whether the configured server exposes the share registry, probed once
 * per session: `GET /share/playlists/pl_probe_absent` — a JSON 404 (or
 * any JSON answer) proves the routes exist; the outdated server's SPA
 * fallback (HTTP 200 HTML, unparseable as JSON) or a network failure
 * proves they don't.
 */
export function shareRegistryAvailable(): Promise<boolean> {
  if (!shareRegistryProbe) {
    shareRegistryProbe = (async () => {
      try {
        const response = await fetch(
          `${apiBase()}/share/playlists/pl_probe_absent`,
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
    // Never memo a rejected probe promise (paranoia — the IIFE swallows
    // its own errors, but a future edit must not poison the session).
    shareRegistryProbe.catch(() => {
      shareRegistryProbe = null;
    });
  }
  return shareRegistryProbe;
}

/* ── registry calls ───────────────────────────────────────────────────── */

/**
 * Publish (or update) a playlist in the share registry.
 *
 * When this playlist was shared before, its stored code rides along so
 * the server updates the same shared copy and the returned link is the
 * one people already have. The code the server answers with is stored
 * for next time.
 */
export async function sharePlaylistOnline(
  playlist: Playlist,
  songs: PlaylistSong[] | Track[],
): Promise<{ code: string; url: string }> {
  const artwork =
    songs.find((song) => song.artwork)?.artwork ??
    (playlist.coverVideoId
      ? `https://i.ytimg.com/vi/${playlist.coverVideoId}/hqdefault.jpg`
      : null);

  // No share registry on the configured server → fall back to a
  // self-contained payload link that any Carmen client can open.
  if (!(await shareRegistryAvailable())) {
    const token = await encodeSharePayload(
      { name: playlist.name, description: playlist.description || null, artwork },
      songs,
    );
    const url = buildPlaylistShareUrl(token);
    if (url.length > SHARE_PAYLOAD_URL_LIMIT) {
      throw new Error(
        'This playlist is too large to share as a self-contained link without a Carmen server — ' +
          'try a smaller playlist, or share it from a Carmen server with playlist sharing enabled.',
      );
    }
    return { code: token, url };
  }

  const storedCode = await getStoredShareCode(playlist.id);
  // A stored payload token is not a registry code — never POST it as one.
  const existingCode = storedCode && PAYLOAD_CODE_RE.test(storedCode) ? null : storedCode;
  let payload: any;
  try {
    payload = await apiPostJson('/share/playlists', {
      ...(existingCode ? { code: existingCode } : {}),
      name: playlist.name,
      description: playlist.description || null,
      artwork,
      tracks: songs.map(shareableTrack),
    });
  } catch (error) {
    // An outdated server has no /share/* routes: an unknown POST route
    // answers 405 (and a missing GET-style route 404) — that is a server
    // version problem, not a sharing failure, so name it as such.
    const status = (error as { status?: unknown })?.status;
    if (status === 404 || status === 405) {
      throw new Error(serverOutdatedMessage('Playlist sharing'));
    }
    throw error;
  }
  // The SPA-fallback answer parses as `null` (or another non-object) —
  // same outdated server, never a share without a code.
  if (!payload || typeof payload !== 'object') {
    throw new Error(serverOutdatedMessage('Playlist sharing'));
  }
  const code =
    typeof payload?.code === 'string' && payload.code
      ? payload.code
      : typeof payload?.share?.code === 'string'
        ? payload.share.code
        : null;
  if (!code) throw new Error('The server did not return a share code — please try again.');
  await storeShareCode(playlist.id, code);
  return { code, url: buildPlaylistShareUrl(code) };
}

/** Fetch a shared playlist by code or full share link. */
export async function resolveSharedPlaylist(
  codeOrLink: string,
): Promise<SharedPlaylistPayload> {
  const code = parsePlaylistShareCode(codeOrLink) ?? (codeOrLink || '').trim();
  if (!code) throw new Error('That share link does not carry a playlist code.');
  // Self-contained payload links decode locally — no network, no registry.
  if (PAYLOAD_CODE_RE.test(code)) return decodeSharePayload(code);
  const payload = await apiGet(`/share/playlists/${encodeURIComponent(code)}`);
  // An outdated server has no /share/* routes: its SPA catch-all
  // answers the GET with index.html (HTTP 200), which parses as `null`,
  // and any payload without a tracks array, a name or a code is not a
  // shared playlist. Never fabricate an empty "Shared playlist" from
  // that — the shared playlist simply isn't reachable on this server.
  if (
    !payload ||
    typeof payload !== 'object' ||
    (!Array.isArray(payload.tracks) && !payload.name && !payload.code)
  ) {
    throw new Error(serverOutdatedMessage('Playlist sharing'));
  }
  return toSharedPayload(payload, code);
}

/**
 * Save a copy of a shared playlist into the local library through the
 * normal playlist repos. Returns the new playlist id.
 */
export async function importSharedPlaylist(codeOrLink: string): Promise<number> {
  const shared = await resolveSharedPlaylist(codeOrLink);
  const playlistId = await createPlaylist(shared.name, shared.description ?? '');
  for (const track of shared.tracks) {
    await addTrackToPlaylist(playlistId, track);
  }
  return playlistId;
}
