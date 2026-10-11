/**
 * Offline source resolution — the single place that answers "where does the
 * audio / cover / lyrics of this song come from?".
 *
 * Order of preference for playback (requirement: offline playback works
 * strictly through the local app):
 *   1. the downloaded file inside the sandbox (asset protocol),
 *   2. the same file as a blob URL (fallback when a WebView refuses the
 *      asset protocol),
 *   3. the live server stream.
 */
import { convertFileSrc } from '@tauri-apps/api/core';

import { allDownloadRecords, type DownloadRecord } from '../db/repos/downloads';
import { isTauri } from '../platform/env';
import type { TrackLyrics, TrackMeta } from '../types/models';
import { parseLrc, plainLyrics, syncedLines } from '../utils/lyrics';
import { readBinary, readText, songFolderPath, toBase64 } from './storage';

const records = new Map<string, DownloadRecord>();
let hydrated = false;

/** Loads the download catalogue into memory (boot, before React renders). */
export async function hydrateLocalLibrary(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const list = await allDownloadRecords();
    records.clear();
    list.forEach((record) => records.set(record.videoId, record));
  } catch (error) {
    console.warn('[offline] hydrate failed', error);
  }
}

export function markDownloaded(record: DownloadRecord): void {
  records.set(record.videoId, record);
}

export function markRemoved(videoId: string): void {
  records.delete(videoId);
}

export function getLocalRecord(videoId: string | null | undefined): DownloadRecord | null {
  if (!videoId) return null;
  return records.get(videoId) ?? null;
}

export function isDownloaded(videoId: string | null | undefined): boolean {
  return getLocalRecord(videoId) !== null;
}

/** All currently downloaded video ids (Library → Songs renders these). */
export function downloadedVideoIds(): string[] {
  return [...records.keys()];
}

export function localArtworkPath(videoId: string | null | undefined): string | null {
  return getLocalRecord(videoId)?.artworkPath ?? null;
}

export function localLyricsPath(videoId: string | null | undefined): string | null {
  return getLocalRecord(videoId)?.lyricsPath ?? null;
}

export type AudioSourceKind = 'asset' | 'blob' | 'stream';

export interface AudioSource {
  url: string;
  kind: AudioSourceKind;
}

const MIME_BY_EXT: Record<string, string> = {
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  mp3: 'audio/mpeg',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  png: 'image/png',
};

function mimeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'audio/mp4';
}

/** Local file via the asset protocol (streaming, range capable). */
export function localAssetSource(videoId: string): AudioSource | null {
  const record = getLocalRecord(videoId);
  if (!record || !isTauri) return null;
  return { url: convertFileSrc(record.audioPath), kind: 'asset' };
}

// Blob fallback — bounded so a long session never accumulates big buffers.
const blobUrls = new Map<string, string>();
const BLOB_LIMIT = 3;

/**
 * The downloaded file as a blob URL — the platform-neutral local source:
 * the WebView's asset protocol where there is one (Tauri), the IndexedDB
 * bytes where there isn't (browser / iOS offline playback).
 */
export async function localBlobSource(videoId: string): Promise<AudioSource | null> {
  const record = getLocalRecord(videoId);
  if (!record) return null;

  const cached = blobUrls.get(videoId);
  if (cached) return { url: cached, kind: 'blob' };

  const bytes = await readBinary(record.audioPath);
  if (!bytes) return null;
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeFor(record.audioPath) }));
  blobUrls.set(videoId, url);
  if (blobUrls.size > BLOB_LIMIT) {
    const oldest = blobUrls.entries().next().value;
    if (oldest) {
      URL.revokeObjectURL(oldest[1]);
      blobUrls.delete(oldest[0]);
    }
  }
  return { url, kind: 'blob' };
}

/**
 * Base64 cover of a downloaded song — what MediaSession gets fed.
 *
 * Bounded LRU: each entry is a whole cover as a base64 string (several
 * hundred KB), so a session that walks through the library must not
 * accumulate one per song — on iOS that alone is enough to take the tab
 * down. A dropped entry is re-read from disk on the next request.
 */
const artworkDataUrls = new Map<string, string | null>();

/** Songs whose cover data URL stays in memory at once. */
const ARTWORK_DATA_LIMIT = 16;

function rememberArtworkDataUrl(videoId: string, url: string | null): void {
  artworkDataUrls.delete(videoId);
  artworkDataUrls.set(videoId, url);
  while (artworkDataUrls.size > ARTWORK_DATA_LIMIT) {
    const oldest = artworkDataUrls.keys().next().value;
    if (oldest === undefined) break;
    artworkDataUrls.delete(oldest);
  }
}

export async function localArtworkDataUrl(videoId: string): Promise<string | null> {
  const cached = artworkDataUrls.get(videoId);
  if (cached !== undefined) return cached ?? null;
  const record = getLocalRecord(videoId);
  if (!record?.artworkPath) return null;
  const bytes = await readBinary(record.artworkPath);
  if (!bytes) {
    rememberArtworkDataUrl(videoId, null);
    return null;
  }
  const url = `data:${mimeFor(record.artworkPath)};base64,${toBase64(bytes)}`;
  rememberArtworkDataUrl(videoId, url);
  return url;
}

/** Forget cached bytes for a song (called when a download is deleted). */
export function invalidateLocalCaches(videoId: string): void {
  artworkDataUrls.delete(videoId);
  const blob = blobUrls.get(videoId);
  if (blob) {
    URL.revokeObjectURL(blob);
    blobUrls.delete(videoId);
  }
}

/**
 * Lyrics of a downloaded song, read straight from disk.
 *
 * New downloads keep the whole `/browsing/track/{id}` payload as `track.json`,
 * so the lyrics (and the authoritative `duration_seconds`) live there — no
 * separate `.lrc` file is written anymore. Older downloads that still have a
 * `lyrics.lrc` / `lyrics.txt` keep working through the fallback below.
 *
 * This is what makes the lyrics panel work with no network at all.
 */
export async function localLyrics(videoId: string): Promise<TrackLyrics | null> {
  // Preferred: the `track.json` saved next to the audio (a full TrackMeta).
  const folder = await songFolderPath(videoId);
  if (folder) {
    const raw = await readText(`${folder}/track.json`);
    if (raw) {
      try {
        const payload = JSON.parse(raw) as TrackMeta | null;
        const synced = syncedLines(payload);
        const plain = plainLyrics(payload);
        if (synced || plain) {
          return {
            synced: synced ?? null,
            unsynced: plain ?? synced?.map((line) => line.text).join('\n') ?? null,
            source: payload?.lyrics?.source ?? 'Local file',
          };
        }
      } catch {
        /* unreadable / not JSON — fall through to the legacy lyrics file */
      }
    }
  }

  // Legacy: a standalone `.lrc` / `.txt` written by an older version.
  const record = getLocalRecord(videoId);
  if (!record?.lyricsPath) return null;
  const text = await readText(record.lyricsPath);
  if (!text || !text.trim()) return null;
  if (record.lyricsSynced || /\.lrc$/i.test(record.lyricsPath)) {
    const lines = parseLrc(text);
    if (lines.length) {
      return {
        synced: lines,
        unsynced: lines.map((line) => line.text).join('\n'),
        source: 'Local file',
      };
    }
  }
  return { synced: null, unsynced: text.trim(), source: 'Local file' };
}
