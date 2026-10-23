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
import { apiGet, apiPostJson } from '../api';
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
 * (the `pl` query parameter), or the bare `pl_…` code itself. Returns
 * `null` for anything else.
 */
export function parsePlaylistShareCode(input: string): string | null {
  const text = (input || '').trim();
  if (!text) return null;
  if (SHARE_CODE_RE.test(text)) return text;
  try {
    const url = new URL(text, window.location.href);
    const pl = url.searchParams.get('pl');
    if (pl && SHARE_CODE_RE.test(pl)) return pl;
  } catch {
    /* not a URL at all — fall through to the raw scan */
  }
  const match = /[?&]pl=(pl_[A-Za-z0-9_-]+)/.exec(text);
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
  const existingCode = await getStoredShareCode(playlist.id);
  const artwork =
    songs.find((song) => song.artwork)?.artwork ??
    (playlist.coverVideoId
      ? `https://i.ytimg.com/vi/${playlist.coverVideoId}/hqdefault.jpg`
      : null);
  const payload = await apiPostJson('/share/playlists', {
    ...(existingCode ? { code: existingCode } : {}),
    name: playlist.name,
    description: playlist.description || null,
    artwork,
    tracks: songs.map(shareableTrack),
  });
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
  const payload = await apiGet(`/share/playlists/${encodeURIComponent(code)}`);
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
