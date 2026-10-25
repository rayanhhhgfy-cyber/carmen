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
// Observable UI state (jobs + snackbar notice) lives in its own module so
// this heavy pipeline can stay out of the initial bundle — Layout, hooks and
// the share flow import the store eagerly, while everything below is loaded
// lazily on first download interaction (see main.tsx's bootstrap).
import { getDownloadsSnapshot, patchJob, removeJob, setNotice } from './downloadsStore';
import { downloadQueue } from './downloadQueue';
import { ensurePersistentStorage } from '../services/storage/persist';

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
  onProgress: (ratio: number, loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  let response: Response;
  try {
    // `no-store`: never reuse a response the player's <audio> element left in
    // the HTTP cache — those are fetched without an Origin header.
    response = await fetch(streamUrl(videoId), { cache: 'no-store', signal });
  } catch (cause) {
    // An abort is a user cancel, not a network failure: re-throw it
    // unwrapped so the pipeline never retries it or holds the queue.
    if ((cause as Error)?.name === 'AbortError') throw cause;
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
      if ((cause as Error)?.name === 'AbortError') throw cause;
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
      onProgress(Math.min(loaded / total, 1), loaded, total);
    }
  } catch (cause) {
    if ((cause as Error)?.name === 'AbortError') throw cause;
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
  onProgress: (ratio: number, loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    // A cancel during the backoff sleep must not start another attempt.
    if (signal?.aborted) throw signal.reason ?? new Error('Download cancelled');
    if (attempt > 1) {
      patchJob(videoId, { step: 'Retrying audio', progress: 0 });
      await sleep(600 * (attempt - 1));
    }
    try {
      return await fetchAudioOnce(videoId, onProgress, signal);
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
  const job = getDownloadsSnapshot().jobs[videoId];
  return Boolean(job && (job.status === 'running' || job.status === 'done'));
}

/* ── Queue positions, cancel state, audio speed ────────────────────────────
 *
 * Waiting jobs show their place in line ("3rd in line") instead of a bare
 * "Queued": `queuedOrder` mirrors the queue's waiting list, and every
 * change (a job starts, is cancelled, or joins) rewrites every waiter's
 * step. A job's `queued` flag — not its step text — is what the
 * smart-downloads status line counts, so the wording can change freely.
 *
 * Cancelling uses three paths, one per state: a held job drops out of the
 * hold list, a waiting job drops out of the queue, and a fetching job is
 * aborted (its AbortController, for the long audio fetch) plus flagged
 * (for the short later phases, which check the flag at each boundary).
 */

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (n % 10 === 1) return `${n}st`;
  if (n % 10 === 2) return `${n}nd`;
  if (n % 10 === 3) return `${n}rd`;
  return `${n}th`;
}

/** VideoIds waiting for a queue slot, in the order they will start. */
const queuedOrder: string[] = [];

/** Rewrites every waiting job's step to its current queue position. */
function updateQueuePositions(): void {
  queuedOrder.forEach((videoId, index) => {
    patchJob(videoId, { step: `${ordinal(index + 1)} in line`, queued: true });
  });
}

function removeFromQueueOrder(videoId: string): void {
  const index = queuedOrder.indexOf(videoId);
  if (index >= 0) {
    queuedOrder.splice(index, 1);
    updateQueuePositions();
  }
}

/** AbortControllers of pipelines currently fetching audio. */
const activeControllers = new Map<string, AbortController>();

/** Jobs whose cancel was requested while their pipeline was mid-flight. */
const cancelledIds = new Set<string>();

function throwIfCancelled(videoId: string): void {
  if (cancelledIds.has(videoId)) {
    const error = new Error('Download cancelled');
    error.name = 'Cancelled';
    throw error;
  }
}

/** Last audio-progress sample per job, for the smoothed speed + ETA. */
interface SpeedSample {
  loaded: number;
  at: number;
  emaBps: number;
}

const speedSamples = new Map<string, SpeedSample>();

/** Turns an audio-progress tick into a speed + ETA patch for the job. */
function reportAudioProgress(
  videoId: string,
  ratio: number,
  loaded: number,
  total: number,
): void {
  const now = Date.now();
  const prev = speedSamples.get(videoId);
  let emaBps = 0;
  if (prev && now > prev.at && loaded > prev.loaded) {
    const instant = ((loaded - prev.loaded) / (now - prev.at)) * 1000;
    emaBps = prev.emaBps > 0 ? prev.emaBps * 0.7 + instant * 0.3 : instant;
  } else if (prev) {
    emaBps = prev.emaBps;
  }
  speedSamples.set(videoId, { loaded, at: now, emaBps });
  patchJob(videoId, {
    step: 'Downloading audio',
    progress: ratio * 0.55,
    loadedBytes: loaded,
    totalBytes: total,
    speedBps: emaBps > 0 ? Math.round(emaBps) : undefined,
    etaSeconds: emaBps > 0 ? Math.ceil((total - loaded) / emaBps) : undefined,
  });
}

/**
 * Cancels a download in progress, from any of its states: a held retry
 * drops out of the hold list, a waiting job drops out of the queue, and
 * a fetching pipeline is aborted (audio fetch) and flagged (later
 * phases). A finished, failed or skipped job is not in progress —
 * cancelling one is a no-op. The job leaves no trace: no hold, no skip,
 * no notice, no half-written folder.
 */
export function cancelDownload(videoId: string): void {
  const job = getDownloadsSnapshot().jobs[videoId];
  if (!job || job.status !== 'running') return;

  // Held for a retry: drop it and hand the timer to the next held song,
  // or resume the queue when none are left.
  const heldIndex = heldDownloads.findIndex((held) => held.track.videoId === videoId);
  if (heldIndex >= 0) {
    heldDownloads.splice(heldIndex, 1);
    if (heldIndex === 0) {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      if (heldDownloads.length > 0) {
        heldDownloads[0].retryAt = Date.now() + HOLD_RETRY_DELAY_MS;
        startHoldTimer();
      } else {
        downloadQueue.resume();
        stopHoldTickerIfIdle();
      }
    }
    removeJob(videoId);
    return;
  }

  // Still waiting for a slot: drop it from the queue and the order.
  if (downloadQueue.cancel(videoId)) {
    removeFromQueueOrder(videoId);
    removeJob(videoId);
    return;
  }

  // Already fetching: abort the audio fetch and flag the later phases.
  // The pipeline's catch removes the job when it surfaces.
  cancelledIds.add(videoId);
  activeControllers.get(videoId)?.abort();
}

/**
 * Retries every skipped download in this session, oldest first.
 * `startDownload` itself skips anything already saved or running, so
 * calling this twice — or while a retry is in flight — is harmless.
 *
 * @returns how many retries were started
 */
export function retrySkippedDownloads(): number {
  const jobs = getDownloadsSnapshot().jobs;
  let started = 0;
  for (const job of Object.values(jobs)) {
    if (job.status !== 'skipped' || !job.track) continue;
    const current = getDownloadsSnapshot().jobs[job.videoId];
    if (current && (current.status === 'running' || current.status === 'done')) continue;
    startDownload(job.track, null);
    started += 1;
  }
  return started;
}

// Skipped songs retry themselves when the connection returns — the
// common case for a skip is the network going away mid-download. The
// listener attaches when this lazily-loaded module first loads, which is
// also the only way skipped jobs can exist in a session.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    const retried = retrySkippedDownloads();
    if (retried > 0) {
      setNotice(
        'info',
        `Back online — retrying ${retried} skipped download${retried === 1 ? '' : 's'}`,
      );
    }
  });
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
    track,
    status: 'running',
    step: waitForCache ? 'Waiting for the stream to finish caching' : 'Downloading audio',
    progress: 0,
    error: undefined,
    loadedBytes: undefined,
    totalBytes: undefined,
    speedBps: undefined,
    etaSeconds: undefined,
  });

  // Every download — single or playlist — goes through the shared FIFO
  // queue: at most a few pipelines fetch at once, the rest wait their
  // turn and say their place in line (see `updateQueuePositions`). The
  // pipeline itself never rejects (it patches its own error state), so
  // the queue always drains.
  void downloadQueue.schedule(
    () => runDownload(track, meta, waitForCache),
    () => {
      if (!queuedOrder.includes(videoId)) queuedOrder.push(videoId);
      updateQueuePositions();
    },
    videoId,
  );
}

/**
 * The download pipeline body, run by the queue once a slot is free.
 * Errors land in the job (and the snackbar) exactly like before — they
 * are caught here so a failed track never rejects into the queue.
 */
async function runDownload(
  track: Track,
  meta: TrackMeta | null,
  waitForCache: (() => Promise<void>) | null,
  /**
   * The failure-hold retry (see `processHeldDownloads` below) — a retry
   * that fails again is skipped and marked, never held a second time.
   */
  isRetry: boolean = false,
): Promise<void> {
  const videoId = track.videoId;
  // The queue slot is now ours: leave the waiting order and tell the
  // status line this job is no longer queued.
  removeFromQueueOrder(videoId);
  patchJob(videoId, { queued: false });
  const controller = new AbortController();
  activeControllers.set(videoId, controller);
  try {
    if (waitForCache) {
      // Restore the waiting label a position patch may have overwritten.
      patchJob(videoId, { step: 'Waiting for the stream to finish caching', progress: 0 });
      try {
        await waitForCache();
      } catch {
        /* waiting is an optimisation — the download proceeds either way */
      }
      throwIfCancelled(videoId);
    }

    // 1 — raw audio bytes
    patchJob(videoId, { step: 'Downloading audio', progress: 0 });
    const { bytes: audioBytes, contentType } = await fetchAudio(
      videoId,
      (ratio, loaded, total) => reportAudioProgress(videoId, ratio, loaded, total),
      controller.signal,
    );
    throwIfCancelled(videoId);

    // 2 — straight to disk, no transcode, no tags
    patchJob(videoId, { step: 'Saving audio', progress: 0.58 });
    const folder = await songFolder(videoId);
    if (!folder) throw new Error('Local storage is unavailable');
    const audioPath = `${folder}/audio.${extensionFor(contentType)}`;
    await writeBinary(audioPath, audioBytes);
    throwIfCancelled(videoId);

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
    throwIfCancelled(videoId);

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
    throwIfCancelled(videoId);

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
    throwIfCancelled(videoId);

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
  } catch (error) {
    const failure = error as Error;
    if (failure?.name === 'AbortError' || failure?.name === 'Cancelled') {
      // User-cancelled: leave nothing behind — no hold, no skip, no
      // notice, and no half-written folder. A fresh download has no
      // earlier complete copy to protect (re-downloads are refused while
      // a copy exists), so deleting the folder is safe.
      cancelledIds.delete(videoId);
      try {
        await deleteSongFolder(videoId);
      } catch {
        /* best effort — an orphan folder is invisible, just wasted space */
      }
      removeJob(videoId);
      return;
    }
    const message = failure?.message || 'Download failed';
    if (isRetry) {
      // Second failure: skip it and mark it, so the queue can move on.
      patchJob(videoId, {
        status: 'skipped',
        step: 'Skipped',
        progress: 0,
        error: message,
      });
      setNotice('info', `Skipped "${track.title}" — ${message}`);
    } else {
      // First failure: hold the queue behind this song (see below).
      enterHold(track, meta, waitForCache, message);
    }
  } finally {
    activeControllers.delete(videoId);
    speedSamples.delete(videoId);
  }
}

/* ── Failure hold: pause, timer, one retry, then skip ────────────────────
 *
 * A failed download used to let everything behind it drain past it, so
 * one server hiccup during a playlist download failed song after song.
 * Now a failure pauses the queue: nothing behind the failed song starts
 * (pipelines already running finish normally), a timer runs, and the
 * failed song is retried once. If it still fails it is skipped and
 * marked, and the queue resumes. The retry runs directly — not through
 * the paused queue, which would never start it — and the failed song's
 * job stays `running` while held, so nothing can start it twice.
 *
 * Held jobs are session-scoped: closing the app mid-hold drops the
 * timers, and the song is simply not downloaded until it is retried
 * manually. A held job's step shows the live countdown (ticked once a
 * second while any hold is active).
 */

/** How long the queue waits after a failure before retrying it. */
const HOLD_RETRY_DELAY_MS = 30_000;

interface HeldDownload {
  track: Track;
  meta: TrackMeta | null;
  waitForCache: (() => Promise<void>) | null;
  error: string;
  retryAt: number;
}

/** Failed songs waiting out their timer, in failure order. */
const heldDownloads: HeldDownload[] = [];
let holdTimer: ReturnType<typeof setTimeout> | null = null;
let holdTicker: ReturnType<typeof setInterval> | null = null;

/** Refreshes the "retrying in Ns" countdown on every held job. */
function tickHeldJobs(): void {
  for (const held of heldDownloads) {
    const seconds = Math.max(0, Math.ceil((held.retryAt - Date.now()) / 1000));
    patchJob(held.track.videoId, {
      status: 'running',
      step: `Paused — retrying in ${seconds}s`,
      progress: 0,
    });
  }
}

function startHoldTicker(): void {
  if (holdTicker) return;
  tickHeldJobs();
  holdTicker = setInterval(tickHeldJobs, 1000);
}

function stopHoldTickerIfIdle(): void {
  if (heldDownloads.length === 0 && holdTicker) {
    clearInterval(holdTicker);
    holdTicker = null;
  }
}

/** Arms the timer for the first held song (no-op while one is running). */
function startHoldTimer(): void {
  if (holdTimer || heldDownloads.length === 0) return;
  const next = heldDownloads[0];
  const delay = Math.max(0, next.retryAt - Date.now());
  holdTimer = setTimeout(() => {
    holdTimer = null;
    void processHeldDownloads();
  }, delay);
}

/** Pauses the queue behind a failed song and starts its retry timer. */
function enterHold(
  track: Track,
  meta: TrackMeta | null,
  waitForCache: (() => Promise<void>) | null,
  error: string,
): void {
  downloadQueue.pause();
  heldDownloads.push({
    track,
    meta,
    waitForCache,
    error,
    retryAt: Date.now() + HOLD_RETRY_DELAY_MS,
  });
  patchJob(track.videoId, {
    status: 'running',
    step: `Paused — retrying in ${Math.ceil(HOLD_RETRY_DELAY_MS / 1000)}s`,
    progress: 0,
  });
  startHoldTicker();
  startHoldTimer();
}

/**
 * Retries the oldest held song once. A success (or a skip, via the
 * `isRetry` path in `runDownload`) clears it; a further held song gets
 * its own fresh timer, and the queue resumes only when none are left.
 */
async function processHeldDownloads(): Promise<void> {
  const held = heldDownloads.shift();
  if (!held) {
    stopHoldTickerIfIdle();
    return;
  }
  // `runDownload` never throws — its own catch marks the job — so a
  // retry can never wedge the queue; this guard is belt-and-braces.
  try {
    await runDownload(held.track, held.meta, held.waitForCache, true);
  } catch {
    /* the job was already marked by runDownload's catch */
  }
  if (heldDownloads.length > 0) {
    heldDownloads[0].retryAt = Date.now() + HOLD_RETRY_DELAY_MS;
    startHoldTimer();
  } else {
    downloadQueue.resume();
    stopHoldTickerIfIdle();
  }
}

/**
 * Downloads a whole playlist's tracks through the existing pipeline.
 *
 * A plain loop over `startDownload` (idempotent and fire-and-forget):
 * tracks already downloaded or already running are skipped — the same
 * checks `startDownload` itself makes, mirrored here so the returned
 * count is exactly how many downloads were started. A failed track
 * pauses the queue behind it (hold → 30s timer → one retry → skip),
 * per the failure-hold policy in `runDownload`. Progress is aggregated
 * by callers from the downloads job store, like any other download.
 *
 * @returns how many downloads were started
 */
export function startPlaylistDownload(tracks: Track[]): number {
  // A bulk download is exactly when the offline copies matter — ask the
  // browser to keep this origin's storage instead of evicting it under
  // pressure later. Fire-and-forget: saving never waits on the answer.
  void ensurePersistentStorage();
  let started = 0;
  for (const track of tracks ?? []) {
    const videoId = track?.videoId;
    if (!videoId) continue;
    if (isDownloaded(videoId) || isRunning(videoId)) continue;
    startDownload(track, null);
    started += 1;
  }
  return started;
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

/** Drops one offline copy completely — folder, row and every cached trace. */
async function purgeOne(videoId: string): Promise<boolean> {
  if (!(await getDownload(videoId))) return false;
  await deleteSongFolder(videoId);
  await deleteDownloadRow(videoId);
  markRemoved(videoId);
  invalidateLocalCaches(videoId);
  setFlag('downloaded', videoId, false);
  return true;
}

/** Removes a song's folder and its row (Library → Songs, long-press/menu). */
export async function removeDownload(videoId: string): Promise<void> {
  if (!(await purgeOne(videoId))) return;
  setNotice('success', 'Removed the offline copy');
}

/**
 * Removes many offline copies at once (Settings → Storage → manage
 * downloads). The per-song notice of `removeDownload` would stack into
 * spam here, so the lot reports as a single snackbar.
 */
export async function purgeDownloads(videoIds: string[]): Promise<void> {
  let removed = 0;
  for (const videoId of videoIds) {
    if (await purgeOne(videoId)) removed += 1;
  }
  setNotice(
    'success',
    removed
      ? `Removed ${removed} offline cop${removed === 1 ? 'y' : 'ies'}`
      : 'Nothing to remove',
  );
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
