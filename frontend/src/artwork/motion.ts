/**
 * Animated ("motion") artwork — the album covers that move.
 *
 * Resolution is split between the client and the server:
 *
 *   1. the public **iTunes Search API** turns `"Album - Artist"` (the term
 *      style `test.py` drives coverpy with — an album title alone matches
 *      the wrong record all too often) into its `collectionId`
 *      (`access-control-allow-origin: *` — plain fetch). Songs that arrive
 *      without an album — flat search/queue records — fall back to an
 *      iTunes **song** search, whose first result points straight at the
 *      collection to animate;
 *   2. `GET /browsing/animated-artwork/{collectionId}` resolves the direct
 *      MP4 on the **server**, which runs coverpy's Apple Music walk (web
 *      token → `amp-api …?extend=editorialVideo` → HLS ladder → one
 *      self-contained MP4) and caches the resulting URL in Redis for a week
 *      (Apple CDN links expire). It answers `null` for albums without motion
 *      artwork and for Apple rate limits alike.
 *
 * Step 2 lives server-side because `amp-api` demands a spoofed
 * `Origin: https://music.apple.com`, which a WebView cannot send — moving it
 * there also lets plain **web** sessions play animated covers, not just the
 * Tauri shell.
 *
 * The bytes are cached so nothing is fetched twice:
 *
 *   <app data>/motion/<collectionId>.mp4   streamed albums (disk cache, Tauri)
 *   <app data>/songs/<videoId>/motion.mp4  saved along with a download
 *
 * A resolved `collectionId` is memoized for the session and persisted, so the
 * disk cache is still found offline. In a browser (no filesystem) the video
 * plays straight from the CORS-open CDN URL.
 *
 * UI contract: the static cover stays put the whole time — a video only
 * replaces it once its element reports `canplay`, and any failure (offline,
 * no motion artwork for this album, low battery mode) degrades to exactly
 * the cover that was already on screen.
 */
import { useEffect, useState } from 'react';
import { readDir, remove, stat } from '@tauri-apps/plugin-fs';

import { apiGet } from '../api';
import { loadAppState, saveAppState } from '../db/repos/appState';
import { isDownloaded } from '../offline/source';
import { fileExists, motionDir, songsDir, writeBinary } from '../offline/storage';
import { isTauri, localFileUrl } from '../platform/env';

/** What an `<Artwork>` needs to find (or fetch) an animated cover. */
export interface MotionArtworkRef {
  /** Album title — the preferred identity and iTunes *album* search term. */
  album?: string | null;
  /** Downloaded track — prefers `<songs>/<id>/motion.mp4`, offline-safe. */
  videoId?: string | null;
  /**
   * Track title + artist: the fallback identity for songs whose flat
   * search/queue records carry no album (the common case for playback
   * started from search). An iTunes *song* search for `"Title - Artist"`
   * returns the collection the track belongs to — that collection is what
   * gets animated.
   */
  title?: string | null;
  artist?: string | null;
}

// ── Plumbing ─────────────────────────────────────────────────────────────────

const RESOLVE_TIMEOUT_MS = 12_000;
/** The server's cold resolve (coverpy token + HLS walk) can take a while. */
const SERVER_TIMEOUT_MS = 20_000;
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

/**
 * What a reference resolves (and caches) under: the album title when one is
 * known, else `"Title - Artist"` for songs that arrive without an album.
 * `null` means the reference carries no usable identity — stay static.
 */
function referenceIdentity(reference: MotionArtworkRef | null | undefined): string | null {
  const album = reference?.album?.trim();
  if (album) return album;
  const title = reference?.title?.trim();
  if (!title) return null;
  const artist = reference?.artist?.trim();
  return artist ? `${title} - ${artist}` : title;
}

// ── iTunes search → Apple Music collection id ────────────────────────────────

/**
 * iTunes Search API — the first result's `collectionId`, or `null`.
 *
 * `test.py` drives coverpy with `"Justice - Justin Bieber"` — album *and*
 * artist — because an album title alone matches the wrong record all the
 * time (`Justice` → the electronic duo, `After Hours` → some random
 * single). Callers compose the term the same way.
 */
async function searchCollectionId(
  term: string,
  entity: 'album' | 'song',
): Promise<number | null> {
  const url =
    `https://itunes.apple.com/search?term=${encodeURIComponent(term)}` +
    `&country=US&media=music&entity=${entity}&limit=1`;
  const response = await withTimeout(
    fetch(url, { headers: { Accept: 'application/json' } }),
    RESOLVE_TIMEOUT_MS,
  );
  if (!response.ok) return null;
  const payload = (await response.json()) as {
    results?: Array<{ collectionId?: unknown }>;
    resultCount?: number;
  };
  const id = payload?.results?.[0]?.collectionId;
  return typeof id === 'number' ? id : null;
}

// ── Resolution cache (session) + id store (persisted) ────────────────────────

const MOTION_IDS_STATE_KEY = 'motionIds';
/** Session memo: identity → iTunes collection id (`null` = none). */
const aidCache = new Map<string, number | null>();
/** Session memo: collection id → server-resolved MP4 URL. */
const urlCache = new Map<number, string | null>();
const pendingAids = new Map<string, Promise<number | null>>();
const pendingUrls = new Map<number, Promise<string | null>>();
const pendingCaches = new Map<string, Promise<string | null>>();

let idStore: Record<string, number> | null = null;
let idSaveTimer: ReturnType<typeof setTimeout> | null = null;

async function storedIds(): Promise<Record<string, number>> {
  if (!idStore) {
    try {
      idStore = await loadAppState<Record<string, number>>(MOTION_IDS_STATE_KEY, {});
    } catch {
      idStore = {};
    }
  }
  return idStore;
}

/** Batched persist — resolving several albums together writes once. */
function scheduleIdSave(): void {
  if (idSaveTimer) return;
  idSaveTimer = setTimeout(() => {
    idSaveTimer = null;
    const snapshot = { ...(idStore ?? {}) };
    void saveAppState(MOTION_IDS_STATE_KEY, snapshot).catch(() => {});
  }, 600);
}

/**
 * The iTunes collection id of the reference's album — the session memo, then
 * the persisted map (offline), then an iTunes search. Album first ("Album -
 * Artist", like test.py); a song with no album falls back to a *song* search.
 */
async function resolveCollectionId(reference: MotionArtworkRef): Promise<number | null> {
  const identity = referenceIdentity(reference);
  if (!identity) return null;

  const memo = aidCache.get(identity);
  if (memo !== undefined) return memo;

  const inFlight = pendingAids.get(identity);
  if (inFlight) return inFlight;

  const task = resolvePool(async () => {
    try {
      // Seen before — the persisted map answers with no network at all,
      // which is what keeps the disk cache usable offline.
      const store = await storedIds();
      const stored = store[identity];
      if (typeof stored === 'number') {
        aidCache.set(identity, stored);
        return stored;
      }

      const album = reference.album?.trim();
      const title = reference.title?.trim();
      const artist = reference.artist?.trim();
      let collectionId: number | null = null;
      if (album) {
        collectionId = await searchCollectionId(
          artist ? `${album} - ${artist}` : album,
          'album',
        );
      }
      if (!collectionId && title) {
        collectionId = await searchCollectionId(
          artist ? `${title} - ${artist}` : title,
          'song',
        );
      }
      aidCache.set(identity, collectionId);
      if (collectionId) {
        store[identity] = collectionId;
        scheduleIdSave();
      }
      return collectionId;
    } catch (error) {
      console.warn('[motion] album lookup failed', identity, error);
      // Session-scoped negative — one blip costs this album until relaunch.
      aidCache.set(identity, null);
      return null;
    }
  });

  pendingAids.set(identity, task);
  try {
    return await task;
  } finally {
    pendingAids.delete(identity);
  }
}

/**
 * The direct MP4 URL for a collection, resolved by the server (which runs
 * coverpy and caches the answer for a week). `null` means "no motion
 * artwork" — or a transient upstream failure, which the server deliberately
 * leaves uncached, so those are not memoized here either.
 */
async function serverMotionUrl(collectionId: number): Promise<string | null> {
  const memo = urlCache.get(collectionId);
  if (memo !== undefined) return memo;

  const inFlight = pendingUrls.get(collectionId);
  if (inFlight) return inFlight;

  const task = (async () => {
    try {
      const payload = await withTimeout(
        apiGet(`/browsing/animated-artwork/${collectionId}`),
        SERVER_TIMEOUT_MS,
      );
      const url = payload?.video_url;
      const resolved = typeof url === 'string' && url ? url : null;
      // Memo clean "no artwork" answers too; the server already decided.
      urlCache.set(collectionId, resolved);
      return resolved;
    } catch (error) {
      console.warn('[motion] server resolve failed', collectionId, error);
      return null; // transient — retried on the next request
    }
  })();

  pendingUrls.set(collectionId, task);
  try {
    return await task;
  } finally {
    pendingUrls.delete(collectionId);
  }
}

// ── Disk cache ───────────────────────────────────────────────────────────────

async function cachedMotionPath(collectionId: number): Promise<string | null> {
  const dir = await motionDir();
  return dir ? `${dir}/${collectionId}.mp4` : null;
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
async function storeMotionVideo(
  collectionId: number,
  bytes: Uint8Array,
): Promise<string | null> {
  const path = await cachedMotionPath(collectionId);
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

/** Makes sure the video is on disk, returns its local path — or null. */
async function cachedVideo(collectionId: number, url: string): Promise<string | null> {
  const key = String(collectionId);
  const inFlight = pendingCaches.get(key);
  if (inFlight) return inFlight;
  const task = (async () => {
    const path = await cachedMotionPath(collectionId);
    if (!path) return null;
    if (await fileExists(path)) return path;
    try {
      const bytes = await downloadVideo(url);
      await writeBinary(path, bytes);
      void pruneMotionCache();
      return path;
    } catch (error) {
      // Caching failed — the caller falls back to the remote URL.
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
 *   2. the persistent disk cache of an earlier stream (`<collectionId>.mp4`),
 *   3. freshly resolved + downloaded into that cache.
 *
 * In a browser (no filesystem) step 3 plays the server-resolved CDN URL
 * directly. Resolves to `null` when the album has no motion artwork.
 */
export async function motionSource(
  reference: MotionArtworkRef | null | undefined,
): Promise<string | null> {
  if (!reference) return null;
  const identity = referenceIdentity(reference);
  if (!identity) return null;

  const videoId = reference.videoId ?? null;
  // 1. The copy saved with a download — offline-safe, Tauri only.
  if (isTauri && videoId && isDownloaded(videoId)) {
    const base = await songsDir();
    if (base) {
      const path = `${base}/${videoId}/motion.mp4`;
      if (await fileExists(path)) return localFileUrl(path);
    }
  }

  // 2. The album's iTunes id (session → persisted → search).
  const collectionId = await resolveCollectionId(reference);
  if (!collectionId) return null;

  // 3. The disk cache from an earlier stream — Tauri only.
  if (isTauri) {
    const cached = await cachedMotionPath(collectionId);
    if (cached && (await fileExists(cached))) return localFileUrl(cached);
  }

  // 4. The server-resolved CDN URL (cached server-side for a week).
  const url = await serverMotionUrl(collectionId);
  if (!url) return null;

  // 5. Web plays straight from the CDN; Tauri downloads into the cache.
  if (!isTauri) return url;
  const path = await cachedVideo(collectionId, url);
  return path ? localFileUrl(path) : url;
}

/**
 * Motion-artwork bytes for a song download — `null` when the album has
 * none. Best effort: a slow catalogue must never fail the download.
 */
export async function fetchMotionArtwork(
  reference: MotionArtworkRef | null | undefined,
): Promise<Uint8Array | null> {
  if (!reference || !isTauri) return null;
  try {
    const collectionId = await resolveCollectionId(reference);
    if (!collectionId) return null;
    const url = await serverMotionUrl(collectionId);
    if (!url) return null;
    return await downloadVideo(url);
  } catch (error) {
    console.warn('[motion] artwork fetch failed', error);
    return null;
  }
}

/**
 * Saves motion-artwork bytes into the shared disk cache next to the
 * download — so later streams (and offline playback) find it without the
 * network even when the song folder copy is what plays.
 */
export async function saveMotionArtwork(
  reference: MotionArtworkRef | null | undefined,
  bytes: Uint8Array,
): Promise<void> {
  if (!reference || !isTauri) return;
  try {
    const collectionId = await resolveCollectionId(reference);
    if (!collectionId) return;
    await storeMotionVideo(collectionId, bytes);
  } catch {
    /* cache hygiene only */
  }
}

/**
 * Resolves the animated cover for one consumer — `PlayerSheet` renders it
 * either across the whole card (desktop) or behind the lyrics (phone).
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
  const identity = referenceIdentity(reference);
  const videoId = reference?.videoId ?? null;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!enabled || !identity || !reference) {
      setUrl(null);
      return () => {
        alive = false;
      };
    }
    // Back to the static cover while the new identity resolves.
    setUrl(null);
    motionSource(reference).then(
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
    // `identity`/`videoId` fully describe the reference; depending on the
    // object itself would restart resolution on every render (call sites
    // pass literals). A same-identity reference resolves identically anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, videoId, enabled]);

  return url;
}
