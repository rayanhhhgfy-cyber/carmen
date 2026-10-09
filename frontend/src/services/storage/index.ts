/**
 * Unified storage adapter — one facade over the two backends the app runs on:
 *
 *   Tauri   → SQLite (`db/repos`) + sandboxed filesystem (`offline/storage`);
 *             this module stays out of the way there (`hydrateBrowserStorage`
 *             is a no-op and nothing else is called).
 *   Browser → IndexedDB (Dexie) for database state **and** file blobs, with
 *             the historical `localStorage` shims kept as the migration
 *             source and as the last-resort backend when IndexedDB is
 *             blocked (private mode).
 *
 * The KV half is deliberately synchronous on the read side: every repo call
 * site talks to it through `db/repos/fallback`'s localStorage-shaped
 * `fallbackGet`/`fallbackSet`, so the whole fallback layer keeps working
 * unchanged while the durable copy moves to IDB (write-behind, mirrored to
 * localStorage for durability). Reads are served from a memory cache that
 * `hydrateBrowserStorage()` fills during bootstrap — **before** the first
 * repo read, exactly like `hydrateSettings` before the first render.
 */
import { isTauri } from '../env';
import type { Track } from '../../types/models';
import {
  openStore,
  type DownloadRow,
  type KvRow,
  type TrackRow,
} from './idb';

export type { DownloadRow, FileRow, KvRow, TrackRow } from './idb';

// ── KV (settings, playlists, favorites, feed, playback, app state) ──────────

const LEGACY_PREFIX = 'carmen.fb.';

/** Memory view of the KV store — reads are `Map.get`, never an await. */
const kvCache = new Map<string, unknown>();
let kvHydrated = false;
let idb: Awaited<ReturnType<typeof openStore>> = null;

function localRead(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(LEGACY_PREFIX + key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function localWrite(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(LEGACY_PREFIX + key, JSON.stringify(value));
  } catch {
    /* private mode / quota — the memory cache still serves this session */
  }
}

function localReadAll(): KvRow[] {
  const rows: KvRow[] = [];
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const storageKey = window.localStorage.key(index);
      if (!storageKey || !storageKey.startsWith(LEGACY_PREFIX)) continue;
      const key = storageKey.slice(LEGACY_PREFIX.length);
      const raw = window.localStorage.getItem(storageKey);
      rows.push({ key, value: raw === null ? null : JSON.parse(raw) });
    }
  } catch {
    /* private mode — nothing to migrate */
  }
  return rows;
}

/**
 * Loads the KV store into memory. Runs once from `main.tsx`'s bootstrap,
 * before any repo touches state:
 *
 *   1. IndexedDB has rows  → they win (the durable copy of every choice),
 *   2. IndexedDB is empty  → seed it from the `carmen.fb.*` localStorage
 *      shims of earlier browser sessions (one-time migration),
 *   3. IndexedDB is blocked → the shims stay the backend, as before.
 */
export async function hydrateBrowserStorage(): Promise<void> {
  if (isTauri || kvHydrated) return;
  kvHydrated = true;
  idb = await openStore();
  try {
    if (idb) {
      const rows = await idb.kv.toArray();
      if (rows.length) {
        rows.forEach((row) => kvCache.set(row.key, row.value));
        return;
      }
      const legacy = localReadAll();
      if (legacy.length) {
        await idb.kv.bulkPut(legacy);
        legacy.forEach((row) => kvCache.set(row.key, row.value));
      }
      return;
    }
  } catch (error) {
    console.warn('[storage] KV hydrate failed', error);
  }
  if (!idb) localReadAll().forEach((row) => kvCache.set(row.key, row.value));
}

/**
 * Synchronous KV read — `fallback` when the key was never written.
 *
 * On a cache miss the legacy localStorage shim is consulted once (and cached),
 * so a read that somehow lands before hydration — or a session whose
 * IndexedDB is blocked — still sees exactly what the old shim would have.
 */
export function kvRead<T>(key: string, fallback: T): T {
  if (kvCache.has(key)) return kvCache.get(key) as T;
  const legacy = localRead(key);
  if (legacy !== undefined) {
    kvCache.set(key, legacy);
    return legacy as T;
  }
  return fallback;
}

/**
 * Synchronous KV write: the memory cache takes it immediately (so the very
 * next read is consistent), IndexedDB persists it in the background and
 * localStorage mirrors it so no choice is ever lost to a torn-down session.
 */
export function kvWrite(key: string, value: unknown): void {
  kvCache.set(key, value);
  localWrite(key, value);
  if (idb) void idb.kv.put({ key, value }).catch(() => {});
}

// ── Files (audio, artwork, lyrics, motion bytes) ────────────────────────────

const MIME: Record<string, string> = {
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  mp3: 'audio/mpeg',
  lrc: 'text/plain',
  txt: 'text/plain',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  png: 'image/png',
};

function mimeForPath(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return MIME[extension] ?? 'application/octet-stream';
}

/** Stores bytes under their virtual path (`songs/<id>/audio.m4a`). */
export async function putFile(path: string, data: Uint8Array): Promise<void> {
  const db = await openStore();
  if (!db) throw new Error('IndexedDB unavailable');
  // Copy into an ArrayBuffer-backed view: fetch() hands out views over
  // `ArrayBufferLike`, which is not a `BlobPart`, and a copy also stops a
  // small subarray view from pinning its whole backing buffer in storage.
  const bytes = new Uint8Array(data);
  await db.files.put({
    path,
    blob: new Blob([bytes], { type: mimeForPath(path) }),
    updatedAt: Date.now(),
  });
}

export async function getFile(path: string): Promise<Blob | null> {
  const db = await openStore();
  if (!db) return null;
  try {
    const row = await db.files.get(path);
    return row?.blob ?? null;
  } catch {
    return null;
  }
}

export async function getFileBytes(path: string): Promise<Uint8Array | null> {
  const blob = await getFile(path);
  if (!blob) return null;
  try {
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

export async function hasFile(path: string): Promise<boolean> {
  const db = await openStore();
  if (!db) return false;
  try {
    const row = await db.files.get(path);
    return Boolean(row);
  } catch {
    return false;
  }
}

export async function deleteFile(path: string): Promise<void> {
  const db = await openStore();
  if (!db) return;
  try {
    await db.files.delete(path);
  } catch {
    /* already gone */
  }
}

/** Deletes every file under a virtual folder prefix (`songs/<id>/`). */
export async function deleteFilesUnder(prefix: string): Promise<void> {
  const db = await openStore();
  if (!db) return;
  try {
    await db.files.where('path').startsWith(prefix).delete();
  } catch {
    /* already gone */
  }
}

// ── Records (tracks + downloads) ────────────────────────────────────────────

export async function putTrackRecord(track: Track): Promise<void> {
  const db = await openStore();
  if (!db) throw new Error('IndexedDB unavailable');
  const row: TrackRow = { videoId: track.videoId, track, updatedAt: Date.now() };
  await db.tracks.put(row);
}

export async function getTrackRecord(videoId: string): Promise<Track | null> {
  const db = await openStore();
  if (!db) return null;
  try {
    const row = await db.tracks.get(videoId);
    return row?.track ?? null;
  } catch {
    return null;
  }
}

export async function deleteTrackRecord(videoId: string): Promise<void> {
  const db = await openStore();
  if (!db) return;
  try {
    await db.tracks.delete(videoId);
  } catch {
    /* already gone */
  }
}

export async function putDownloadRecord(row: DownloadRow): Promise<void> {
  const db = await openStore();
  if (!db) throw new Error('IndexedDB unavailable');
  await db.downloads.put(row);
}

export async function getDownloadRecord(videoId: string): Promise<DownloadRow | null> {
  const db = await openStore();
  if (!db) return null;
  try {
    return (await db.downloads.get(videoId)) ?? null;
  } catch {
    return null;
  }
}

export async function allDownloadRecords(): Promise<DownloadRow[]> {
  const db = await openStore();
  if (!db) return [];
  try {
    return await db.downloads.toArray();
  } catch {
    return [];
  }
}

export async function deleteDownloadRecord(videoId: string): Promise<void> {
  const db = await openStore();
  if (!db) return;
  try {
    await db.downloads.delete(videoId);
  } catch {
    /* already gone */
  }
}

export async function patchDownloadLyricsRecord(
  videoId: string,
  lyricsPath: string | null,
  lyricsSynced: boolean,
): Promise<void> {
  const db = await openStore();
  if (!db) return;
  try {
    await db.downloads.update(videoId, { lyricsPath, lyricsSynced });
  } catch {
    /* record gone — nothing to patch */
  }
}
