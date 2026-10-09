/**
 * IndexedDB schema — the browser/iOS twin of Tauri's SQLite + filesystem pair.
 *
 * One Dexie database holds four stores, each mirroring exactly one thing the
 * Tauri build keeps somewhere else, so callers never care which backend they
 * are on:
 *
 *   kv        ← → SQLite `settings` / `app_state` / playlists / favorites /
 *                feed / playback_state (via `db/repos/fallback`)
 *   files     ← → `<app data>/songs/…` etc. (`offline/storage`)
 *   tracks    ← → SQLite `tracks`
 *   downloads ← → SQLite `downloads` (metadata + file locations)
 *
 * Blobs live directly in IndexedDB ("IndexedDB Blobs"): Safari has supported
 * storing `Blob`s since iOS 10, and it keeps the offline pipeline a plain
 * structured-clone round trip — no object URLs to manage at rest.
 */
import Dexie, { type Table } from 'dexie';

import type { Track } from '../../types/models';

/** One KV row — settings, playlists, feed, playback, app state. */
export interface KvRow {
  key: string;
  value: unknown;
}

/** One stored file — audio, artwork, lyrics or motion bytes. */
export interface FileRow {
  path: string;
  blob: Blob;
  updatedAt: number;
}

/** Canonical track metadata (the `tracks` table's twin). */
export interface TrackRow {
  videoId: string;
  track: Track;
  updatedAt: number;
}

/** One finished download: its track plus where its files live. */
export interface DownloadRow {
  videoId: string;
  track: Track;
  audioPath: string;
  artworkPath: string | null;
  lyricsPath: string | null;
  lyricsSynced: boolean;
  bytes: number | null;
  downloadedAt: number;
}

class CarmenStore extends Dexie {
  kv!: Table<KvRow, string>;
  files!: Table<FileRow, string>;
  tracks!: Table<TrackRow, string>;
  downloads!: Table<DownloadRow, string>;

  constructor() {
    super('carmen');
    this.version(1).stores({
      kv: 'key',
      files: 'path',
      tracks: 'videoId',
      downloads: 'videoId',
    });
  }
}

let store: CarmenStore | null = null;
let opening: Promise<CarmenStore | null> | null = null;

/**
 * Opens the database once and caches the handle.
 *
 * Returns `null` when IndexedDB is unavailable (private browsing, blocked
 * storage, quota-exceeded databases) — callers then degrade: KV to
 * localStorage, file/record writes to a hard failure.
 */
export function openStore(): Promise<CarmenStore | null> {
  if (store) return Promise.resolve(store);
  if (!opening) {
    opening = (async () => {
      try {
        const candidate = new CarmenStore();
        await candidate.open();
        store = candidate;
        return store;
      } catch (error) {
        console.warn('[storage] IndexedDB unavailable — falling back', error);
        return null;
      }
    })();
  }
  return opening;
}
