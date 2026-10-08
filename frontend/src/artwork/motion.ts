/**
 * Animated ("motion") artwork — the album covers that move.
 *
 * A TypeScript port of the `coverpy` Python client exercised in `test.py`
 * (`CoverPy().get_cover()` + `get_motion_artwork()`), running entirely in the
 * client:
 *
 *   1. the public **iTunes Search API** turns an album title into its
 *      `collectionId` (`access-control-allow-origin: *` — plain fetch);
 *   2. Apple's own **music.apple.com web token** — scraped from the web
 *      bundle once and persisted in `app_state` (it lives ~60 days) — unlocks
 *      `amp-api.music.apple.com/v1/catalog/…?extend=editorialVideo`, which
 *      hands out the HLS master playlist of the motion artwork;
 *   3. the master playlist is walked for H.264 variants, preferring an exact
 *      **468×468** rendition and falling back to coverpy's "standard"
 *      480–720 px pick (Apple's real ladders are 360/408/456/486/768/960/
 *      1080, so 468 only wins where a ladder offers it). The variant
 *      playlist's `#EXT-X-MAP` resolves to one self-contained MP4 — the same
 *      file the segments byte-range into, so it plays and stores as-is.
 *
 * Steps 2–3 go through `@tauri-apps/plugin-http` (Rust-backed): the WebView
 * cannot make them — `amp-api` requires a spoofed
 * `Origin: https://music.apple.com`, which browsers forbid as a header.
 * That also means the feature only exists inside the Tauri shell; a plain
 * `vite dev` session simply keeps static covers.
 *
 * The bytes are cached so nothing is ever fetched twice:
 *
 *   <app data>/motion/<key>.mp4             streamed albums (disk cache)
 *   <app data>/songs/<videoId>/motion.mp4   saved along with a download
 *
 * UI contract: the static cover stays put the whole time — a video only
 * replaces it once its element reports `canplay`, and any failure (offline,
 * no motion artwork for this album, low battery mode) degrades to exactly
 * the cover that was already on screen.
 */
import { useEffect, useState } from 'react';
import { readDir, remove, stat } from '@tauri-apps/plugin-fs';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

import { loadAppState, saveAppState } from '../db/repos/appState';
import { isDownloaded } from '../offline/source';
import { fileExists, motionDir, songsDir, writeBinary } from '../offline/storage';
import { isTauri, localFileUrl } from '../platform/env';

/** What an `<Artwork>` needs to find (or fetch) an animated cover. */
export interface MotionArtworkRef {
  /** Album title — also the iTunes search term and the cache key. */
  album?: string | null;
  /** Downloaded track — prefers `<songs>/<id>/motion.mp4`, offline-safe. */
  videoId?: string | null;
}

// ── Plumbing ─────────────────────────────────────────────────────────────────

const RESOLVE_TIMEOUT_MS = 12_000;
const BUNDLE_TIMEOUT_MS = 45_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
/** How many albums may resolve at once — a shelf of tiles must not stampede. */
const RESOLVE_CONCURRENCY = 3;
/** How many multi-megabyte videos may download at once. */
const DOWNLOAD_CONCURRENCY = 2;
/** Disk budget for streamed covers; the oldest files are dropped first. */
const CACHE_FILE_LIMIT = 150;

function createPool(limit: number) {
  let active = 0;
  const waiters: Array<() => void> = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiters.shift()?.();
    }
  };
}

const resolvePool = createPool(RESOLVE_CONCURRENCY);
const downloadPool = createPool(DOWNLOAD_CONCURRENCY);

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('motion artwork request timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

interface PluginTextResult {
  ok: boolean;
  status: number;
  body: string;
}

interface PluginJsonResult {
  ok: boolean;
  status: number;
  payload: unknown;
}

/** Text hop through the Rust-backed fetch: no CORS, any header allowed. */
async function pluginText(
  url: string,
  headers: Record<string, string> = {},
): Promise<PluginTextResult> {
  const response = (await tauriFetch(url, { headers })) as unknown as {
    ok: boolean;
    status: number;
    text(): Promise<string>;
  };
  const body = await response.text();
  return { ok: response.ok, status: response.status, body };
}

/** JSON hop through the Rust-backed fetch (status included — 401 matters). */
async function pluginJson(
  url: string,
  headers: Record<string, string> = {},
): Promise<PluginJsonResult> {
  const response = (await tauriFetch(url, { headers })) as unknown as {
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  };
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { ok: response.ok, status: response.status, payload };
}

// ── Cache keys ───────────────────────────────────────────────────────────────

/**
 * Stable, filename-safe key for an album title. Two FNV-1a passes (forward
 * and reversed) give ~64 bits — collisions between real album names are not
 * a practical concern at this scale.
 */
function motionKey(album: string): string {
  const normalized = album.trim().toLowerCase().replace(/\s+/g, ' ');
  let forward = 0x811c9dc5;
  let backward = 0x1b873593;
  for (let index = 0; index < normalized.length; index += 1) {
    forward = Math.imul(forward ^ normalized.charCodeAt(index), 0x01000193) >>> 0;
  }
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    backward = Math.imul(backward ^ normalized.charCodeAt(index), 0x85ebca6b) >>> 0;
  }
  return `m${forward.toString(36)}${backward.toString(36)}`;
}

// ── Apple web token (persisted — the bundle scrape happens rarely) ──────────

const TOKEN_BOOTSTRAP_URL = 'https://music.apple.com/us/album/1693323844';
const TOKEN_STATE_KEY = 'motionToken';
const TOKEN_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const SCRIPT_PATTERN = /src=["'](\/assets\/index[^"']+\.js)["']/;

interface StoredToken {
  token: string;
  exp: number;
}

let tokenMemory: StoredToken | null = null;
let tokenBoot: Promise<string> | null = null;
/** A token Apple rejected — never use it (or its persisted copy) again. */
let poisonedToken: string | null = null;

function decodeTokenPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const payload: unknown = JSON.parse(atob(padded));
    return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Scrapes the AMP web bundle for the `AMPWebPlay` JWT (~3 MB, once). */
async function bootstrapToken(): Promise<string> {
  const page = await withTimeout(pluginText(TOKEN_BOOTSTRAP_URL), RESOLVE_TIMEOUT_MS);
  if (!page.ok) throw new Error('motion: token bootstrap page failed');
  const bundlePath = SCRIPT_PATTERN.exec(page.body)?.[1];
  if (!bundlePath) throw new Error('motion: web bundle not found');
  const bundle = await withTimeout(
    pluginText(`https://music.apple.com${bundlePath}`),
    BUNDLE_TIMEOUT_MS,
  );
  if (!bundle.ok) throw new Error('motion: web bundle fetch failed');
  for (const token of bundle.body.match(TOKEN_PATTERN) ?? []) {
    if (decodeTokenPayload(token)?.iss === 'AMPWebPlay') return token;
  }
  throw new Error('motion: web token not found');
}

/** The current web token — from memory, the persisted copy, or a fresh scrape. */
async function webToken(): Promise<string> {
  const now = Date.now() / 1000;
  if (tokenMemory && tokenMemory.token !== poisonedToken && tokenMemory.exp > now + 60) {
    return tokenMemory.token;
  }
  if (tokenBoot) return tokenBoot;
  tokenBoot = (async () => {
    if (!poisonedToken) {
      try {
        const stored = await loadAppState<StoredToken | null>(TOKEN_STATE_KEY, null);
        if (stored?.token && stored.exp > now + 60) {
          tokenMemory = stored;
          return stored.token;
        }
      } catch {
        /* fall through to a fresh bootstrap */
      }
    }
    const token = await bootstrapToken();
    const exp = Number(decodeTokenPayload(token)?.exp) || Math.floor(now + 60 * 24 * 3600);
    tokenMemory = { token, exp };
    void saveAppState(TOKEN_STATE_KEY, tokenMemory).catch(() => {});
    return token;
  })();
  try {
    return await tokenBoot;
  } finally {
    tokenBoot = null;
  }
}

// ── iTunes search → Apple Music album → editorial video ─────────────────────

/** iTunes Search API — returns the first album's catalog id, or `null`. */
async function searchAlbumId(album: string): Promise<number | null> {
  const url =
    `https://itunes.apple.com/search?term=${encodeURIComponent(album)}` +
    '&country=US&media=music&entity=album&limit=1';
  const response = await withTimeout(
    fetch(url, { headers: { Accept: 'application/json' } }),
    RESOLVE_TIMEOUT_MS,
  );
  if (!response.ok) return null;
  const payload = (await response.json()) as { results?: Array<{ collectionId?: unknown }> };
  const id = payload?.results?.[0]?.collectionId;
  return typeof id === 'number' ? id : null;
}

/** `amp-api` editorial metadata → the HLS master playlist of the square video. */
async function editorialVideoUrl(collectionId: number): Promise<string | null> {
  const url =
    `https://amp-api.music.apple.com/v1/catalog/us/albums/${collectionId}` +
    '?extend=editorialVideo';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await webToken();
    const response = await withTimeout(
      pluginJson(url, {
        Authorization: `Bearer ${token}`,
        // amp-api authenticates the *web player's* origin as well as the JWT.
        Origin: 'https://music.apple.com',
        Accept: 'application/json',
      }),
      RESOLVE_TIMEOUT_MS,
    );
    if (response.status === 401 || response.status === 403) {
      poisonedToken = token;
      continue; // scrape a fresh token and try exactly once more
    }
    if (!response.ok) return null;
    const payload = response.payload as {
      data?: Array<{
        attributes?: {
          editorialVideo?: Record<string, { video?: unknown } | undefined>;
        };
      }>;
    };
    const editorial = payload?.data?.[0]?.attributes?.editorialVideo;
    if (!editorial) return null;
    const square = editorial.motionSquareVideo1x1 ?? editorial.motionDetailSquare;
    const video = square?.video;
    return typeof video === 'string' && video ? video : null;
  }
  return null;
}

// ── HLS → one direct MP4 (coverpy's algorithm + the 468 preference) ─────────

interface HlsVariant {
  playlistUrl: string;
  bandwidth: number;
  width: number | null;
  codecs: string;
}

/** `KEY="value"` / `KEY=value` pairs — quoted values may contain commas. */
const ATTRIBUTE_PATTERN = /([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))(?:,|$)/g;
const MAP_URI_PATTERN = /URI="([^"]+)"/;

function resolveUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).toString();
  } catch {
    return relative;
  }
}

function parseMasterPlaylist(masterUrl: string, text: string): HlsVariant[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const variants: HlsVariant[] = [];
  lines.forEach((line, index) => {
    if (!line.startsWith('#EXT-X-STREAM-INF:')) return;
    const attributes = new Map<string, string>();
    ATTRIBUTE_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    const attributeText = line.slice(line.indexOf(':') + 1);
    while ((match = ATTRIBUTE_PATTERN.exec(attributeText)) !== null) {
      attributes.set(match[1], match[2] ?? match[3] ?? '');
    }
    const playlistUrl = lines
      .slice(index + 1)
      .find((candidate) => candidate && !candidate.startsWith('#'));
    if (!playlistUrl) return;
    const resolution = attributes.get('RESOLUTION') ?? '';
    const widthText = resolution.split('x')[0];
    const width = /^\d+$/.test(widthText) ? Number(widthText) : null;
    const bandwidthText = attributes.get('AVERAGE-BANDWIDTH') || attributes.get('BANDWIDTH');
    const bandwidth = bandwidthText && /^\d+$/.test(bandwidthText) ? Number(bandwidthText) : 0;
    variants.push({
      playlistUrl: resolveUrl(masterUrl, playlistUrl),
      bandwidth,
      width,
      codecs: attributes.get('CODECS') ?? '',
    });
  });
  return variants;
}

/** The rendition to play: 468 if the ladder has it, else coverpy's pick. */
function standardVariant(variants: HlsVariant[]): HlsVariant {
  const exact = variants.find((variant) => variant.width === 468);
  if (exact) return exact;
  const preferred = variants.filter(
    (variant) => variant.width !== null && variant.width >= 480 && variant.width <= 720,
  );
  if (preferred.length) {
    return preferred.reduce((best, variant) => {
      const bestDistance = Math.abs((best.width ?? 600) - 600);
      const distance = Math.abs((variant.width ?? 600) - 600);
      return distance < bestDistance || (distance === bestDistance && variant.bandwidth < best.bandwidth)
        ? variant
        : best;
    });
  }
  const ordered = [...variants].sort((a, b) => a.bandwidth - b.bandwidth);
  return ordered.length >= 3 ? ordered[Math.floor(ordered.length / 3)] : ordered[0];
}

/** The whole video file behind a playlist — the `#EXT-X-MAP` byte range. */
function directVideoUrl(playlistUrl: string, text: string): string | null {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const stripped = line.trim();
    if (!stripped.startsWith('#EXT-X-MAP:')) continue;
    const match = MAP_URI_PATTERN.exec(stripped);
    if (match) return resolveUrl(playlistUrl, match[1]);
  }
  for (const line of lines) {
    const stripped = line.trim();
    if (stripped && !stripped.startsWith('#') && stripped.includes('.mp4')) {
      return resolveUrl(playlistUrl, stripped);
    }
  }
  return null;
}

/** Master playlist → chosen variant → direct, self-contained MP4 URL. */
async function resolveVideoUrl(hlsUrl: string): Promise<string | null> {
  const master = await withTimeout(pluginText(hlsUrl), RESOLVE_TIMEOUT_MS);
  if (!master.ok) return null;
  const variants = parseMasterPlaylist(hlsUrl, master.body);
  if (!variants.length) return directVideoUrl(hlsUrl, master.body);
  const compatible = variants.filter((variant) => variant.codecs.toLowerCase().includes('avc1'));
  const candidates = compatible.length ? compatible : variants;
  const chosen = standardVariant(candidates);
  const variant = await withTimeout(pluginText(chosen.playlistUrl), RESOLVE_TIMEOUT_MS);
  if (!variant.ok) return null;
  return directVideoUrl(chosen.playlistUrl, variant.body);
}

// ── Resolution cache (session) + URL store (persisted) ──────────────────────

const URLS_STATE_KEY = 'motionUrls';
/** Settled results for this session — `null` means "this album has none". */
const resolutionCache = new Map<string, string | null>();
const pendingResolutions = new Map<string, Promise<string | null>>();
const pendingCaches = new Map<string, Promise<string | null>>();

let urlStore: Record<string, string> | null = null;
let urlSaveTimer: ReturnType<typeof setTimeout> | null = null;

async function storedUrls(): Promise<Record<string, string>> {
  if (!urlStore) {
    try {
      urlStore = await loadAppState<Record<string, string>>(URLS_STATE_KEY, {});
    } catch {
      urlStore = {};
    }
  }
  return urlStore;
}

/** Batched persist — a shelf of tiles resolving together writes once. */
function scheduleUrlSave(): void {
  if (urlSaveTimer) return;
  urlSaveTimer = setTimeout(() => {
    urlSaveTimer = null;
    const snapshot = { ...(urlStore ?? {}) };
    void saveAppState(URLS_STATE_KEY, snapshot).catch(() => {});
  }, 600);
}

/** Resolves the direct MP4 URL for an album — pooled, memoized, persisted. */
async function resolvedUrl(album: string): Promise<string | null> {
  const key = motionKey(album);
  const cached = resolutionCache.get(key);
  if (cached !== undefined) return cached;
  const inFlight = pendingResolutions.get(key);
  if (inFlight) return inFlight;

  const task = resolvePool(async () => {
    try {
      const store = await storedUrls();
      const stored = store[key];
      if (stored) {
        resolutionCache.set(key, stored);
        return stored;
      }
      const collectionId = await searchAlbumId(album);
      if (!collectionId) {
        resolutionCache.set(key, null);
        return null;
      }
      const hlsUrl = await editorialVideoUrl(collectionId);
      if (!hlsUrl) {
        resolutionCache.set(key, null);
        return null;
      }
      const videoUrl = await resolveVideoUrl(hlsUrl);
      resolutionCache.set(key, videoUrl);
      if (videoUrl) {
        store[key] = videoUrl;
        scheduleUrlSave();
      }
      return videoUrl;
    } catch (error) {
      console.warn('[motion] resolve failed', album, error);
      // Session-scoped negative: one blip costs this album until relaunch,
      // never the whole shelf (each album fails independently).
      resolutionCache.set(key, null);
      return null;
    }
  });

  pendingResolutions.set(key, task);
  try {
    return await task;
  } finally {
    pendingResolutions.delete(key);
  }
}

// ── Disk cache ───────────────────────────────────────────────────────────────

async function cachedMotionPath(key: string): Promise<string | null> {
  const dir = await motionDir();
  return dir ? `${dir}/${key}.mp4` : null;
}

/** Drops the oldest files once the cache grows past its budget. */
async function pruneMotionCache(): Promise<void> {
  const dir = await motionDir();
  if (!dir) return;
  try {
    const entries = (await readDir(dir)).filter(
      (entry) => entry.isFile && entry.name.endsWith('.mp4'),
    );
    if (entries.length <= CACHE_FILE_LIMIT) return;
    const detailed = await Promise.all(
      entries.map(async (entry) => {
        const path = `${dir}/${entry.name}`;
        try {
          const info = await stat(path);
          return { path, mtime: info.mtime ? info.mtime.getTime() : 0 };
        } catch {
          return { path, mtime: 0 };
        }
      }),
    );
    const excess = detailed
      .sort((a, b) => a.mtime - b.mtime)
      .slice(0, detailed.length - CACHE_FILE_LIMIT);
    await Promise.all(excess.map((file) => remove(file.path).catch(() => {})));
  } catch {
    /* cache hygiene only — never surface it */
  }
}

/** Downloads the MP4 itself (CORS-open CDN), two at a time. */
async function downloadVideo(url: string): Promise<Uint8Array> {
  return downloadPool(async () => {
    const response = await withTimeout(fetch(url), DOWNLOAD_TIMEOUT_MS);
    if (!response.ok) throw new Error(`motion video HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  });
}

/** Writes bytes into the shared cache and returns the path written. */
async function storeMotionVideo(album: string, bytes: Uint8Array): Promise<string | null> {
  const path = await cachedMotionPath(motionKey(album));
  if (!path) return null;
  try {
    if (await fileExists(path)) return path;
    await writeBinary(path, bytes);
    void pruneMotionCache();
    return path;
  } catch (error) {
    console.warn('[motion] cache write failed', error);
    return null;
  }
}

/** Makes sure the video is on disk, returns its local path — or the URL. */
async function cachedVideo(key: string, url: string): Promise<string | null> {
  const inFlight = pendingCaches.get(key);
  if (inFlight) return inFlight;
  const task = (async () => {
    const path = await cachedMotionPath(key);
    if (!path) return null;
    if (await fileExists(path)) return path;
    try {
      const bytes = await downloadVideo(url);
      await writeBinary(path, bytes);
      void pruneMotionCache();
      return path;
    } catch (error) {
      // Caching failed — the remote file still plays (the CDN is CORS-open).
      console.warn('[motion] cache download failed', error);
      return null;
    }
  })();
  pendingCaches.set(key, task);
  try {
    return await task;
  } finally {
    pendingCaches.delete(key);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Where an album's animated cover plays from:
 *   1. the copy saved with a downloaded track (works offline),
 *   2. the persistent disk cache of an earlier stream,
 *   3. freshly resolved + downloaded into that cache (remote URL as the
 *      last resort when even caching failed).
 *
 * Resolves to `null` when the album simply has no motion artwork.
 */
export async function motionSource(
  reference: MotionArtworkRef | null | undefined,
): Promise<string | null> {
  const album = reference?.album?.trim();
  if (!album || !isTauri) return null; // plain-web sessions stay static

  const videoId = reference?.videoId ?? null;
  if (videoId && isDownloaded(videoId)) {
    const base = await songsDir();
    if (base) {
      const path = `${base}/${videoId}/motion.mp4`;
      if (await fileExists(path)) return localFileUrl(path);
    }
  }

  const key = motionKey(album);
  const cached = await cachedMotionPath(key);
  if (cached && (await fileExists(cached))) return localFileUrl(cached);

  const url = await resolvedUrl(album);
  if (!url) return null;
  const path = await cachedVideo(key, url);
  return path ? localFileUrl(path) : url;
}

/**
 * Motion-artwork bytes for a song download — `null` when the album has
 * none. Best effort: a slow catalogue must never fail the download.
 */
export async function fetchMotionArtwork(
  album: string | null | undefined,
): Promise<Uint8Array | null> {
  const trimmed = album?.trim();
  if (!trimmed || !isTauri) return null;
  try {
    const url = await resolvedUrl(trimmed);
    if (!url) return null;
    return await downloadVideo(url);
  } catch (error) {
    console.warn('[motion] artwork fetch failed', error);
    return null;
  }
}

/**
 * Saves motion-artwork bytes into the shared disk cache next to the
 * download — so tiles (and offline playback) find it without the network
 * even when the song folder copy is what plays.
 */
export async function saveMotionArtwork(
  album: string | null | undefined,
  bytes: Uint8Array,
): Promise<void> {
  const trimmed = album?.trim();
  if (!trimmed || !isTauri) return;
  await storeMotionVideo(trimmed, bytes);
}

/**
 * Resolves the animated cover for one tile.
 *
 * Returns the URL once it is *playable-or-remotely-available* — the caller
 * keeps the static cover on screen until then. `null` means "stay static",
 * both while disabled (low battery mode, the settings toggle, no viewport
 * proximity) and for albums without motion artwork.
 */
export function useMotionArtwork(
  reference: MotionArtworkRef | null | undefined,
  enabled: boolean,
): string | null {
  const album = reference?.album?.trim() || null;
  const videoId = reference?.videoId ?? null;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!enabled || !album) {
      setUrl(null);
      return () => {
        alive = false;
      };
    }
    // Back to the static cover while the new identity resolves.
    setUrl(null);
    motionSource({ album, videoId }).then(
      (result) => {
        if (alive) setUrl(result);
      },
      () => {
        if (alive) setUrl(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [album, videoId, enabled]);

  return url;
}

