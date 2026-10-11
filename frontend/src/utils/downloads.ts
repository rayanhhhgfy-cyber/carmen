/**
 * Offline download pipeline — **raw files only**.
 *
 * There is no conversion and no tagging step anymore: the bytes that come out
 * of `/stream` are stored verbatim as `audio.<ext>` next to the high-res
 * cover (`artwork.<ext>`), the full `/browsing/track/{id}` payload
 * (`track.json` — the single source of truth for lyrics *and*
 * `duration_seconds`) and the animated cover (`motion.mp4`, when the album
 * has one) inside the app sandbox, and the SQLite row is written afterwards.
 *
 *   <app data>/songs/<videoId>/{audio.m4a, artwork.jpg, track.json, motion.mp4}
 *
 * No standalone `lyrics.lrc` / `lyrics.txt` is written anymore — the lyrics
 * ride along inside `track.json` (see `localLyrics`). The audio file itself is
 * never trusted for its duration (fragmented / corrupted m4a can claim a
 * doubled length): `duration_seconds` from the payload is the authority.
 *
 * ffmpeg / MP3 / ID3 are deliberately gone — see DEVELOPMENT.md.
 */
import { apiGet, streamUrl } from '../api';
import { fetchMotionArtwork, saveMotionArtwork } from '../artwork/motion';
import {
  deleteDownloadRow,
  getDownload,
  insertDownload,
  listDownloads,
} from '../db/repos/downloads';
import { upsertTrack } from '../db/repos/tracks';
import { deleteSongFolder, songFolder, writeBinary, writeText } from '../offline/storage';
import { setFlag } from '../db/flags';
import {
  invalidateLocalCaches,
  isDownloaded,
  markDownloaded,
  markRemoved,
} from '../offline/source';
import type { Track, TrackMeta } from '../types/models';
import { plainLyrics, syncedLines } from './lyrics';
import { cdnArtwork, pickArtwork } from './track';

// ── Observable download store ───────────────────────────────────────────────

export type DownloadStatus = 'running' | 'done' | 'error';

export interface DownloadJob {
  videoId: string;
  title?: string;
  status?: DownloadStatus;
  step?: string;
  progress?: number;
  error?: string;
}

export interface DownloadNotice {
  id: number;
  severity: 'success' | 'error' | 'info';
  message: string;
}

export interface DownloadsSnapshot {
  jobs: Record<string, DownloadJob>;
  notice: DownloadNotice | null;
}

const listeners = new Set<() => void>();

let store: DownloadsSnapshot = { jobs: {}, notice: null };
let noticeSeq = 0;

function commit(next: Partial<DownloadsSnapshot>): void {
  store = { ...store, ...next };
  listeners.forEach((listener) => listener());
}

function patchJob(videoId: string, patch: Partial<DownloadJob>): void {
  const job: DownloadJob = store.jobs[videoId] || { videoId };
  commit({ jobs: { ...store.jobs, [videoId]: { ...job, ...patch } } });
}

function setNotice(severity: DownloadNotice['severity'], message: string): void {
  noticeSeq += 1;
  commit({ notice: { id: noticeSeq, severity, message } });
}

/**
 * Publish a transient app-wide notice — the snackbar Layout renders on top
 * of the downloads store. Exposed for callers outside the download flow
 * (e.g. "link copied" after a share).
 */
export function notify(severity: DownloadNotice['severity'], message: string): void {
  setNotice(severity, message);
}

export function subscribeDownloads(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDownloadsSnapshot(): DownloadsSnapshot {
  return store;
}

export function clearNotice(): void {
  if (store.notice) commit({ notice: null });
}

// ── Audio bytes ─────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function networkError(cause: unknown): Error {
  const error = new Error(
    'Could not reach the server for the audio — check your connection and try again',
  );
  (error as Error & { retryable?: boolean }).retryable = true;
  error.cause = cause;
  return error;
}

async function fetchAudioOnce(
  videoId: string,
  onProgress: (ratio: number) => void,
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  let response: Response;
  try {
    // `no-store`: never reuse a response the player's <audio> element left in
    // the HTTP cache — those are fetched without an Origin header.
    response = await fetch(streamUrl(videoId), { cache: 'no-store' });
  } catch (cause) {
    throw networkError(cause);
  }

  if (!response.ok) {
    let detail = `audio request failed (${response.status})`;
    try {
      const payload = await response.json();
      if (payload?.detail) detail = String(payload.detail);
    } catch {
      /* not a json body */
    }
    const error = new Error(detail);
    (error as Error & { retryable?: boolean }).retryable = [500, 502, 503, 504].includes(
      response.status,
    );
    throw error;
  }

  const contentType = response.headers.get('content-type');
  const total = Number(response.headers.get('content-length')) || 0;

  if (!response.body || !total) {
    const buffer = await response.arrayBuffer().catch((cause) => {
      throw networkError(cause);
    });
    return { bytes: new Uint8Array(buffer), contentType };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onProgress(Math.min(loaded / total, 1));
    }
  } catch (cause) {
    throw networkError(cause);
  }

  const buffer = new Uint8Array(loaded);
  let offset = 0;
  chunks.forEach((chunk) => {
    buffer.set(chunk, offset);
    offset += chunk.length;
  });
  return { bytes: buffer, contentType };
}

async function fetchAudio(
  videoId: string,
  onProgress: (ratio: number) => void,
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (attempt > 1) {
      patchJob(videoId, { step: 'Retrying audio', progress: 0 });
      await sleep(600 * (attempt - 1));
    }
    try {
      return await fetchAudioOnce(videoId, onProgress);
    } catch (error) {
      lastError = error as Error;
      if (!(lastError as Error & { retryable?: boolean }).retryable) throw lastError;
    }
  }
  throw lastError ?? new Error('Download failed');
}

/** Raw container of the stream — stored as-is, never re-encoded. */
function extensionFor(contentType: string | null): string {
  const type = (contentType || '').toLowerCase();
  if (type.includes('webm')) return 'webm';
  if (type.includes('ogg') || type.includes('opus')) return 'ogg';
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
  return 'm4a';
}

// ── Cover art ───────────────────────────────────────────────────────────────

async function fetchImage(url: string): Promise<{ bytes: Uint8Array; ext: string } | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (response.status === 429 || response.status === 503) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      if (!response.ok) return null;
      const blob = await response.blob();
      if (blob.size <= 1024) return null;
      const type = response.headers.get('content-type') || blob.type || '';
      const ext = type.includes('webp') ? 'webp' : type.includes('png') ? 'png' : 'jpg';
      return { bytes: new Uint8Array(await blob.arrayBuffer()), ext };
    } catch {
      await sleep(300);
      return null;
    }
  }
  return null;
}

/** Largest usable cover — high resolution, stored byte-for-byte. */
async function fetchArtwork(
  track: Track,
  meta: TrackMeta | null,
): Promise<{ bytes: Uint8Array; ext: string } | null> {
  const candidates = [
    ...new Set(
      [
        cdnArtwork(track.videoId),
        track.videoId ? `https://i.ytimg.com/vi/${track.videoId}/hq720.jpg` : null,
        track.videoId ? `https://i.ytimg.com/vi/${track.videoId}/sddefault.jpg` : null,
        track.videoId ? `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg` : null,
        pickArtwork(meta),
        track.artwork,
      ].filter((url): url is string => Boolean(url)),
    ),
  ];

  for (const url of candidates) {
    const image = await fetchImage(url);
    if (image) return image;
  }
  return null;
}

// ── Pipeline ────────────────────────────────────────────────────────────────

/**
 * Backfills the album of a track from its enriched `/browsing/track/{id}`
 * payload.
 *
 * Rows that start their life in a search result or a queue often carry no
 * album at all, which made the Albums section of the Library group them under
 * "Unknown album". The payload always ships one (string or object form), so
 * the record written to SQLite gets it before the track does.
 */
function withAlbumFrom(track: Track, meta: TrackMeta | null): Track {
  if (track.albumName || !meta?.album) return track;
  const raw = meta.album;
  const name = typeof raw === 'string' ? raw : raw?.name;
  if (!name) return track;
  const id = typeof raw === 'string' ? null : (raw?.id ?? null);
  return { ...track, albumName: name, album: { name, id } };
}

/**
 * Sets the duration of a track from its `/browsing/track/{id}` payload.
 *
 * The m4a on disk is never the source of truth for length (a fragmented or
 * corrupted container can claim a doubled duration), so the payload's
 * `duration_seconds` is written into the SQLite row and is what the player
 * shows — online *and* offline. When the payload carries one it wins over
 * whatever a search result or queue entry already held.
 */
function withDurationFrom(track: Track, meta: TrackMeta | null): Track {
  const seconds = meta?.duration_seconds;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    return track;
  }
  return { ...track, durationSeconds: seconds, duration: track.duration ?? null };
}

function isRunning(videoId: string): boolean {
  const job = store.jobs[videoId];
  return Boolean(job && (job.status === 'running' || job.status === 'done'));
}

export interface StartDownloadOptions {
  /** Awaited first — see `PlayerContext.waitForCache`. */
  waitForCache?: () => Promise<void>;
}

/**
 * Downloads a song into the app sandbox.
 *
 * @param track normalized track
 * @param meta enriched `/browsing/track/{id}` payload (lyrics + thumbnails)
 */
export function startDownload(
  track: Track,
  meta: TrackMeta | null,
  options: StartDownloadOptions = {},
): void {
  const videoId = track.videoId;
  if (!videoId || isRunning(videoId)) return;

  if (isDownloaded(videoId)) {
    patchJob(videoId, { title: track.title, status: 'done', step: 'Saved', progress: 1 });
    return;
  }

  const waitForCache = typeof options.waitForCache === 'function' ? options.waitForCache : null;

  patchJob(videoId, {
    title: track.title,
    status: 'running',
    step: waitForCache ? 'Waiting for the stream to finish caching' : 'Downloading audio',
    progress: 0,
  });

  void (async () => {
    if (waitForCache) {
      try {
        await waitForCache();
      } catch {
        /* waiting is an optimisation — the download proceeds either way */
      }
    }

    // 1 — raw audio bytes
    patchJob(videoId, { step: 'Downloading audio', progress: 0 });
    const { bytes: audioBytes, contentType } = await fetchAudio(videoId, (ratio) =>
      patchJob(videoId, { step: 'Downloading audio', progress: ratio * 0.55 }),
    );

    // 2 — straight to disk, no transcode, no tags
    patchJob(videoId, { step: 'Saving audio', progress: 0.58 });
    const folder = await songFolder(videoId);
    if (!folder) throw new Error('Local storage is unavailable');
    const audioPath = `${folder}/audio.${extensionFor(contentType)}`;
    await writeBinary(audioPath, audioBytes);

    // 3 — high resolution cover
    patchJob(videoId, { step: 'Fetching cover art', progress: 0.62 });
    let artworkPath: string | null = null;
    try {
      const cover = await fetchArtwork(track, meta);
      if (cover) {
        artworkPath = `${folder}/artwork.${cover.ext}`;
        await writeBinary(artworkPath, cover.bytes);
      }
    } catch {
      /* a missing cover never fails the download */
    }
    patchJob(videoId, { progress: 0.8 });

    // 4 — the full `/browsing/track/{id}` payload → `track.json`.
    // This is the single offline source of truth: it carries the lyrics (so
    // no separate .lrc/.txt is written) *and* the authoritative
    // `duration_seconds`, which the audio file itself can never be trusted
    // for (fragmented / corrupted m4a claims a doubled length).
    patchJob(videoId, { step: 'Fetching track data', progress: 0.82 });
    let enriched = meta;
    try {
      let payload = meta;
      // Re-fetch whenever the passed meta is missing either the lyrics or the
      // duration — `track.json` must be complete on its own.
      if (
        (!payload?.lyrics?.synced && !payload?.lyrics?.unsynced) ||
        typeof payload?.duration_seconds !== 'number'
      ) {
        payload = await apiGet(`/browsing/track/${videoId}`);
      }
      enriched = payload;
      await writeText(`${folder}/track.json`, JSON.stringify(payload));
    } catch {
      /* track.json is best effort — the song still plays without it */
    }

    // 4b — animated cover (Apple motion artwork), when the album has one.
    // Best effort, like the cover and track.json: the catalogue may be slow
    // or unreachable, but a song already on disk must still finish saving.
    patchJob(videoId, { step: 'Fetching animated cover', progress: 0.87 });
    const savedTrack = withDurationFrom(withAlbumFrom(track, enriched), enriched);
    try {
      const motionRef = {
        album: savedTrack.albumName,
        videoId: savedTrack.videoId,
        title: savedTrack.title,
        artist: savedTrack.artist,
      };
      const motionBytes = await fetchMotionArtwork(motionRef);
      if (motionBytes) {
        await writeBinary(`${folder}/motion.mp4`, motionBytes);
        // …and a copy in the shared cache, so tiles (which know no videoId)
        // can play it offline too.
        await saveMotionArtwork(motionRef, motionBytes);
      }
    } catch {
      /* motion artwork never fails a download */
    }

    // 5 — record everything in SQLite
    patchJob(videoId, { step: 'Updating library', progress: 0.9 });
    await insertDownload({
      track: savedTrack,
      audioPath,
      artworkPath,
      // No standalone lyrics file anymore — `track.json` carries the lyrics,
      // so the legacy columns stay null for new downloads.
      lyricsPath: null,
      lyricsSynced: false,
      bytes: audioBytes.byteLength,
    });
    markDownloaded({
      videoId,
      audioPath,
      artworkPath,
      lyricsPath: null,
      lyricsSynced: false,
      downloadedAt: Date.now(),
    });
    setFlag('downloaded', videoId, true);

    patchJob(videoId, { status: 'done', step: 'Saved', progress: 1 });
    setNotice(
      'success',
      track.artist && track.artist !== 'Unknown artist'
        ? `Saved "${track.artist} - ${track.title}"`
        : `Saved "${track.title}"`,
    );
  })().catch((error: Error) => {
    patchJob(videoId, {
      status: 'error',
      step: 'Failed',
      progress: 0,
      error: error?.message || 'Download failed',
    });
    setNotice('error', error?.message || 'Download failed');
  });
}

/**
 * Stores the track metadata of a song next to its (potential) audio — the
 * same `track.json` the download pipeline writes, so lyrics saved this way
 * are read back by `localLyrics` exactly like a full download's.
 *
 * @returns the file name, or `null` when the payload is unusable
 */
export async function downloadLyrics(track: Track, meta: TrackMeta | null): Promise<string | null> {
  const synced = syncedLines(meta);
  const plain = plainLyrics(meta);
  if (!synced && !plain) return null;

  const folder = await songFolder(track.videoId);
  if (!folder) return null;

  // The lyrics panel reads `track.json`; persist the payload verbatim so the
  // offline copy matches what `/browsing/track` would return.
  const path = `${folder}/track.json`;
  await writeText(path, JSON.stringify(meta));

  setNotice('success', `Saved "track.json" for "${track.title}"`);
  return 'track.json';
}

/** Removes a song's folder and its row (Library → Songs, long-press/menu). */
export async function removeDownload(videoId: string): Promise<void> {
  if (!(await getDownload(videoId))) return;
  await deleteSongFolder(videoId);
  await deleteDownloadRow(videoId);
  markRemoved(videoId);
  invalidateLocalCaches(videoId);
  setFlag('downloaded', videoId, false);
  setNotice('success', 'Removed the offline copy');
}

/**
 * One-off repair for downloads saved before the album backfill existed:
 * rows grouped under "Unknown album" get their album fetched from
 * `/browsing/track/{id}` and written back to `tracks`.
 *
 * Bounded (25 rows per launch, 4 at a time) so it never delays the UI — it
 * runs fire-and-forget after bootstrap and converges over a few launches.
 */
export async function backfillAlbumNames(limit = 25): Promise<void> {
  const songs = await listDownloads({ sort: 'title', dir: 'asc' });
  const missing = songs.filter((song) => !song.albumName && song.videoId).slice(0, limit);
  if (!missing.length) return;

  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const song = missing[cursor++];
      if (!song) return;
      try {
        const meta: TrackMeta = await apiGet(`/browsing/track/${song.videoId}`);
        const enriched = withAlbumFrom(song, meta);
        if (enriched.albumName) await upsertTrack(enriched);
      } catch {
        /* one bad id must not stall the rest */
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}
