/**
 * Tauri stream cache — `<app data>/.cache/<videoId>.<ext>`.
 *
 * The browser's HTTP cache quietly holds `/stream` responses (the server
 * sends `Cache-Control: public, max-age=3600`), but the Tauri WebViews keep
 * no persistent HTTP cache, so every replay re-downloaded the song. This
 * module gives the installed app its own file-backed cache:
 *
 *  - the first play still streams live and fills the file in the
 *    background; the next one plays it from the asset protocol, offline;
 *  - boot sweeps anything older than a week and drops orphaned `.part`
 *    files (a fill interrupted before the rename never plays and never
 *    waits for the sweep);
 *  - Settings measures it (`appCacheSize`) and wipes it (`clearAppCache`).
 *
 * The web has no file cache of its own — the same Settings rows report the
 * artwork Cache Storage there instead (see `utils/artwork`). Everything
 * here is best-effort: a failed fill just means the next play streams
 * again, and nothing here may ever break playback.
 */
import { convertFileSrc } from '@tauri-apps/api/core';
import { mkdir, readDir, remove, rename, stat, writeFile } from '@tauri-apps/plugin-fs';

import { streamUrl } from '../api';
import { isDownloaded, type AudioSource } from '../offline/source';
import { isTauri, storagePaths } from '../platform/env';
import { artworkCacheSize, clearArtworkCache } from './artwork';

/** Cached audio older than this is swept when the app opens. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let cacheDirectory: string | null = null;
let initPromise: Promise<void> | null = null;
/** videoId → absolute path of a finished cache file (filled at boot). */
const known = new Map<string, string>();
/** Songs whose background fill is already running. */
const filling = new Set<string>();

/** Same extension table as the download pipeline (see utils/downloads). */
function extensionFor(contentType: string | null): string {
  const type = (contentType || '').toLowerCase();
  if (type.includes('webm')) return 'webm';
  if (type.includes('ogg') || type.includes('opus')) return 'ogg';
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
  return 'm4a';
}

async function sweep(): Promise<void> {
  try {
    const paths = await storagePaths();
    const base = `${paths.appData}/.cache`;
    await mkdir(base, { recursive: true }).catch(() => {});
    cacheDirectory = base;
    const now = Date.now();
    for (const entry of await readDir(base)) {
      if (!entry.isFile) continue;
      const path = `${base}/${entry.name}`;
      if (entry.name.endsWith('.part')) {
        await remove(path).catch(() => {}); // half-written — never playable
        continue;
      }
      try {
        const info = await stat(path);
        const mtime = info.mtime ? info.mtime.getTime() : 0;
        if (mtime && now - mtime > MAX_AGE_MS) {
          await remove(path).catch(() => {});
          continue;
        }
      } catch {
        continue;
      }
      const id = entry.name.replace(/\.[^.]+$/, '');
      if (id && !known.has(id)) known.set(id, path);
    }
  } catch {
    /* no cache here (missing dir, permissions) — streaming still works */
  }
}

/**
 * Boot hook: create the cache directory, sweep week-old files and index
 * what is left so lookups stay synchronous. Idempotent; resolves to a
 * no-op in the browser.
 */
export function initStreamCache(): Promise<void> {
  if (!isTauri) return Promise.resolve();
  initPromise ??= sweep();
  return initPromise;
}

/** The parked copy of *videoId*, or `null` — sync, for the player's chain. */
export function cachedStreamSource(videoId: string): AudioSource | null {
  const path = isTauri ? known.get(videoId) : undefined;
  return path ? { url: convertFileSrc(path), kind: 'asset' } : null;
}

/**
 * Download the stream once into `.cache` — best-effort and idempotent,
 * never awaited by playback (the song is already playing live). Skipped
 * for songs the user already downloaded: their file wins the chain anyway.
 */
export async function fillStreamCache(videoId: string): Promise<void> {
  if (!isTauri || known.has(videoId) || filling.has(videoId)) return;
  filling.add(videoId);
  try {
    if (isDownloaded(videoId)) return;
    await initStreamCache();
    const base = cacheDirectory;
    if (!base || known.has(videoId)) return;
    const response = await fetch(streamUrl(videoId));
    if (!response.ok) return;
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength) return;
    const final = `${base}/${videoId}.${extensionFor(response.headers.get('content-type'))}`;
    const part = `${final}.part`;
    // Rename on success: an interrupted fill leaves only the `.part`, which
    // neither plays nor survives the next boot.
    await writeFile(part, new Uint8Array(buffer));
    await rename(part, final);
    const previous = known.get(videoId);
    if (previous && previous !== final) await remove(previous).catch(() => {});
    known.set(videoId, final);
  } catch {
    /* opportunistic — the live stream already played */
  } finally {
    filling.delete(videoId);
  }
}

/** Bytes parked in the stream cache (Settings → Storage). */
export async function streamCacheSize(): Promise<number> {
  if (!isTauri) return 0;
  await initStreamCache();
  const base = cacheDirectory;
  if (!base) return 0;
  let total = 0;
  try {
    for (const entry of await readDir(base)) {
      if (!entry.isFile) continue;
      try {
        const info = await stat(`${base}/${entry.name}`);
        total += info.size ?? 0;
      } catch {
        /* skip the unreadable one */
      }
    }
  } catch {
    /* nothing cached yet */
  }
  return total;
}

/** Wipes every parked stream (Settings → Storage → Clear). */
export async function clearStreamCache(): Promise<void> {
  if (!isTauri) return;
  await initStreamCache();
  known.clear();
  const base = cacheDirectory;
  if (!base) return;
  try {
    for (const entry of await readDir(base)) {
      if (entry.isFile) await remove(`${base}/${entry.name}`).catch(() => {});
    }
  } catch {
    /* already empty */
  }
}

/**
 * What Settings → Storage calls "cache" on this platform: the `.cache`
 * directory inside Tauri, the artwork Cache Storage on the web.
 */
export async function appCacheSize(): Promise<number> {
  if (isTauri) return streamCacheSize();
  return artworkCacheSize();
}

/** The matching clear button. */
export async function clearAppCache(): Promise<void> {
  if (isTauri) return clearStreamCache();
  return clearArtworkCache();
}
