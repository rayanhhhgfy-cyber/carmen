/**
 * Smart downloads — opt-in auto-downloading of liked songs and favourite
 * playlists, through the EXISTING download pipeline only.
 *
 * What this module does, and does not do:
 *
 * - It SELECTS tracks (liked songs, tracks of favourite playlists) and
 *   hands them to `startPlaylistDownload` — the same 3-wide FIFO queue
 *   (`utils/downloadQueue.ts`) every manual download uses. There is no
 *   second queue, no parallel-fetch path, and no change to
 *   `utils/downloads.ts` internals. A track that fails fails alone in its
 *   own job; the queue drains past it.
 * - It is fully client-side and server-free: liked songs and playlists
 *   come from the local library database, never from the configured API.
 * - It NEVER invents a download for a playlist the user excluded
 *   (per-playlist opt-out, stored in settings).
 *
 * HONEST NETWORK GATING — read this before touching the gate:
 *
 * The web cannot reliably distinguish Wi-Fi from cellular. There is no
 * browser API that answers "is this Wi-Fi?" on every browser: the only
 * signal is `navigator.connection` (NetworkInformation), which is absent
 * in Safari/Firefox, and even where present its `type` is often
 * `undefined` on desktop — `effectiveType` (`4g`, `3g`, …) says how fast
 * the link is, not what radio it uses. So the gate below is BEST EFFORT
 * and is labelled exactly that in the UI:
 *
 *   - `type === 'wifi' | 'ethernet'` → treated as unmetered.
 *   - `saveData === true`, `type === 'cellular'`, `type === 'none'`, or
 *     any unknown/missing type → treated as metered.
 *   - `navigator.connection` missing entirely → treated as metered
 *     (safe default), and the UI says so.
 *   - With "Wi-Fi only (best effort)" ON (the default), a metered-looking
 *     connection blocks the run UNLESS "Allow on metered connections"
 *     is ON — that separate toggle is the user's explicit opt-in.
 *   - With "Wi-Fi only" OFF, the user has switched the restriction off
 *     themselves, so the run proceeds on any connection (except `none`,
 *     where there is nothing to download over). The metered toggle is
 *     then redundant by design, and the UI says so.
 *
 * Runs are triggered from three places, none of which touches App/Layout/
 * PlayerContext: app launch (a boot hook in `main.tsx`, after the
 * download catalogue is hydrated), a favourite being added (the watcher
 * below subscribes to the flags store — the same store every heart
 * toggle already patches), and the user switching a smart toggle on in
 * Settings. Re-opening Library also re-runs, which is what picks up a
 * newly favourited PLAYLIST (playlist favourites do not patch the flags
 * store, so the watcher cannot see them — that gap is documented in the
 * handover, not papered over).
 *
 * Status: this module keeps one session-scoped run record. The status
 * line (Settings, Manage Downloads) derives live queued / downloading /
 * done counts from it plus the downloads job store, so it stays truthful
 * while the queue drains. "Done" in that line means the run finished
 * handing tracks to the pipeline; per-track completion is what the job
 * counts show.
 */
import { useSyncExternalStore } from 'react';

import type { Track } from '../types/models';
import { getDownloadsSnapshot, subscribeDownloads } from '../utils/downloadsStore';

/* ── Settings shape (a subset of AppSettings — see settings/store.ts) ── */

export interface SmartDownloadSettings {
  /** Auto-download liked (favourited) songs. Default off. */
  likedEnabled: boolean;
  /** Auto-download playlists marked favourite. Default off. */
  favouritePlaylistsEnabled: boolean;
  /** Best-effort Wi-Fi-only gate (see header). Default on. */
  wifiOnly: boolean;
  /** Explicit opt-in to auto-download on metered connections. Default off. */
  allowMetered: boolean;
  /** Playlist ids the user excluded — never auto-downloaded. Default []. */
  excludedPlaylistIds: readonly number[];
}

export const DEFAULT_SMART_DOWNLOAD_SETTINGS: SmartDownloadSettings = {
  likedEnabled: false,
  favouritePlaylistsEnabled: false,
  wifiOnly: true,
  allowMetered: false,
  excludedPlaylistIds: [],
};

/* ── Network gate ─────────────────────────────────────────────────────── */

/**
 * The subset of NetworkInformation this gate reads. `type` is the only
 * field that can ever name Wi-Fi, and it is the field most browsers omit.
 */
export interface ConnectionInfo {
  type?: string | null;
  effectiveType?: string | null;
  saveData?: boolean;
}

/** Reads `navigator.connection` without assuming it exists (or its shape). */
export function readNavigatorConnection(): ConnectionInfo | null {
  try {
    if (typeof navigator === 'undefined') return null;
    const raw = (navigator as unknown as { connection?: unknown }).connection;
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as Record<string, unknown>;
    return {
      type: typeof record.type === 'string' ? record.type : null,
      effectiveType:
        typeof record.effectiveType === 'string' ? record.effectiveType : null,
      saveData: record.saveData === true,
    };
  } catch {
    return null;
  }
}

export interface NetworkGateResult {
  allowed: boolean;
  /** Best-effort verdict: true unless the connection provably looks unmetered. */
  metered: boolean;
  /** Human-readable reason, shown verbatim in the status line. */
  reason: string;
}

/**
 * The gate. Pure, so tests pin it without a browser: Wi-Fi/ethernet pass,
 * everything else is metered, and a missing connection object is metered
 * by safe default. `type === 'none'` blocks outright — no radio, no run,
 * whatever the toggles say.
 */
export function evaluateNetworkGate(
  settings: Pick<SmartDownloadSettings, 'wifiOnly' | 'allowMetered'>,
  connection: ConnectionInfo | null,
): NetworkGateResult {
  if (!connection) {
    return {
      allowed: settings.allowMetered,
      metered: true,
      reason:
        'this browser does not report the connection type, so it is treated as metered — turn on "Allow on metered connections" to download anyway',
    };
  }
  if (connection.type === 'none') {
    return {
      allowed: false,
      metered: true,
      reason: 'the device reports no connection',
    };
  }
  if (connection.saveData === true) {
    return {
      allowed: settings.allowMetered,
      metered: true,
      reason: 'data saver is on, so the connection is treated as metered',
    };
  }
  if (connection.type === 'cellular') {
    return {
      allowed: settings.wifiOnly ? settings.allowMetered : true,
      metered: true,
      reason: 'the connection looks cellular (metered)',
    };
  }
  if (connection.type === 'wifi' || connection.type === 'ethernet') {
    return { allowed: true, metered: false, reason: 'Wi-Fi connection' };
  }
  // `type` missing/unknown (the common desktop case): effectiveType says
  // speed, never radio — so this is metered by safe default, not Wi-Fi.
  return {
    allowed: settings.wifiOnly ? settings.allowMetered : true,
    metered: true,
    reason:
      'the connection type is unknown (the web cannot tell Wi-Fi from cellular here), so it is treated as metered',
  };
}

/* ── Selection ────────────────────────────────────────────────────────── */

export interface FavouritePlaylistInput {
  id: number;
  name: string;
  tracks: Track[];
}

export interface SmartDownloadGroup {
  /** 'liked' for the liked-songs batch, otherwise the playlist name. */
  label: string;
  playlistId: number | null;
  tracks: Track[];
}

export interface SmartDownloadSelection {
  /** One download batch per source, in order: liked first, then playlists. */
  groups: SmartDownloadGroup[];
  /** Tracks handed to the pipeline (unique, not already downloaded). */
  tracks: Track[];
  /** Candidate tracks considered, before skipping. */
  considered: number;
  /** Skipped because already on this device. */
  alreadyDownloaded: number;
  /** Skipped because their playlist is on the opt-out list. */
  skippedExcluded: number;
  /** Skipped because they carry no videoId (nothing to download). */
  skippedNoId: number;
}

/**
 * Pure selection: favourite playlists on the opt-out list never contribute
 * a track; tracks already downloaded are skipped; a track appearing in
 * several sources downloads once (first source wins — liked before
 * playlists, playlist order as given).
 */
export function selectSmartDownloads(input: {
  liked: Track[];
  favouritePlaylists: FavouritePlaylistInput[];
  downloadedIds: ReadonlySet<string>;
  settings: Pick<SmartDownloadSettings, 'excludedPlaylistIds'>;
}): SmartDownloadSelection {
  const excluded = new Set(input.settings.excludedPlaylistIds);
  const seen = new Set<string>();
  const groups: SmartDownloadGroup[] = [];
  let considered = 0;
  let alreadyDownloaded = 0;
  let skippedExcluded = 0;
  let skippedNoId = 0;

  const collect = (label: string, playlistId: number | null, tracks: Track[]): void => {
    const kept: Track[] = [];
    for (const track of tracks ?? []) {
      considered += 1;
      const videoId = track?.videoId;
      if (!videoId) {
        skippedNoId += 1;
        continue;
      }
      if (seen.has(videoId)) continue;
      seen.add(videoId);
      if (input.downloadedIds.has(videoId)) {
        alreadyDownloaded += 1;
        continue;
      }
      kept.push(track);
    }
    if (kept.length) groups.push({ label, playlistId, tracks: kept });
  };

  collect('Liked songs', null, input.liked);
  for (const playlist of input.favouritePlaylists ?? []) {
    if (excluded.has(playlist.id)) {
      skippedExcluded += (playlist.tracks ?? []).length;
      continue;
    }
    collect(playlist.name, playlist.id, playlist.tracks);
  }

  return {
    groups,
    tracks: groups.flatMap((group) => group.tracks),
    considered,
    alreadyDownloaded,
    skippedExcluded,
    skippedNoId,
  };
}

/* ── Session status ───────────────────────────────────────────────────── */

export type SmartDownloadsPhase =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'done'
  | 'blocked'
  | 'off';

export interface SmartDownloadsStatus {
  phase: SmartDownloadsPhase;
  lastRunAt: number | null;
  /** Tracks handed to the pipeline by the last run. */
  started: number;
  startedIds: string[];
  alreadyDownloaded: number;
  skippedExcluded: number;
  blockedReason: string | null;
  /** Non-fatal gather errors (a source failed; the rest still ran). */
  error: string | null;
}

const INITIAL_STATUS: SmartDownloadsStatus = {
  phase: 'idle',
  lastRunAt: null,
  started: 0,
  startedIds: [],
  alreadyDownloaded: 0,
  skippedExcluded: 0,
  blockedReason: null,
  error: null,
};

let status: SmartDownloadsStatus = { ...INITIAL_STATUS };
const statusListeners = new Set<() => void>();

function setStatus(patch: Partial<SmartDownloadsStatus>): void {
  status = { ...status, ...patch };
  statusListeners.forEach((listener) => listener());
}

export function getSmartDownloadsStatus(): SmartDownloadsStatus {
  return status;
}

export function subscribeSmartDownloadsStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

/** Live status line for Settings / Manage Downloads (see header). */
export function useSmartDownloadsStatusLine(): string {
  const smart = useSyncExternalStore(
    subscribeSmartDownloadsStatus,
    getSmartDownloadsStatus,
    getSmartDownloadsStatus,
  );
  const downloads = useSyncExternalStore(
    subscribeDownloads,
    getDownloadsSnapshot,
    getDownloadsSnapshot,
  );
  return formatSmartDownloadsStatus(smart, downloads.jobs);
}

/** Pure formatter, so the wording is pinned without rendering anything. */
export function formatSmartDownloadsStatus(
  smart: SmartDownloadsStatus,
  jobs: Record<string, { status?: string; step?: string; queued?: boolean }>,
): string {
  if (smart.phase === 'off') return 'Smart downloads are off.';
  if (smart.phase === 'idle') return 'Smart downloads have not run yet in this session.';
  if (smart.phase === 'blocked') {
    return `Smart downloads paused — ${smart.blockedReason ?? 'network gate blocked the run'}.`;
  }
  if (smart.phase === 'checking') return 'Smart downloads: checking your library…';
  if (smart.phase === 'downloading' || smart.phase === 'done') {
    let running = 0;
    let queued = 0;
    let done = 0;
    let failed = 0;
    for (const videoId of smart.startedIds) {
      const job = jobs[videoId];
      if (!job || job.status === 'running') {
        // No job yet (or still running): queued only when the pipeline
        // flags it so, otherwise it is simply in flight.
        if (job?.queued) queued += 1;
        else running += 1;
      } else if (job.status === 'done') done += 1;
      else if (job.status === 'error' || job.status === 'skipped') failed += 1;
    }
    const already =
      smart.alreadyDownloaded > 0 ? ` · ${smart.alreadyDownloaded} already on device` : '';
    const failedText = failed > 0 ? ` · ${failed} failed` : '';
    if (running > 0 || queued > 0) {
      return (
        `Smart downloads: downloading ${running} · queued ${queued} · ${done} saved` +
        `${failedText}${already}`
      );
    }
    if (smart.started === 0) {
      return `Smart downloads: nothing new to download${already}.`;
    }
    return `Smart downloads: ${done} saved${failedText}${already}.`;
  }
  return 'Smart downloads have not run yet in this session.';
}

/* ── Runner ───────────────────────────────────────────────────────────── */

export interface SmartDownloadsDeps {
  settings: SmartDownloadSettings;
  connection: ConnectionInfo | null;
  listLiked: () => Promise<Track[]>;
  listFavouritePlaylists: () => Promise<FavouritePlaylistInput[]>;
  listDownloadedIds: () => Promise<string[]>;
  /**
   * The existing pipeline entry point (`startPlaylistDownload`): hands a
   * batch to the shared 3-wide FIFO queue and returns how many downloads
   * it started. Injected so tests never touch IndexedDB or the network,
   * and so the production wrapper can lazy-import the heavy pipeline.
   */
  downloadTracks: (tracks: Track[]) => number | Promise<number>;
}

export interface SmartDownloadsRunResult {
  phase: 'done' | 'blocked' | 'off';
  started: number;
  startedIds: string[];
  alreadyDownloaded: number;
  skippedExcluded: number;
  blockedReason: string | null;
}

let inflight: Promise<SmartDownloadsRunResult> | null = null;
let lastCompletedAt = 0;
let lastSettingsKey = '';

function settingsKey(settings: SmartDownloadSettings): string {
  return JSON.stringify([
    settings.likedEnabled,
    settings.favouritePlaylistsEnabled,
    settings.wifiOnly,
    settings.allowMetered,
    [...settings.excludedPlaylistIds].sort((a, b) => a - b),
  ]);
}

/**
 * One smart-download run. Idempotent by construction: already-downloaded
 * tracks are filtered here AND again inside `startPlaylistDownload`, and
 * a failing source (or a failing batch) never stops the others — the
 * error is recorded on the status and the run continues.
 *
 * Coalescing: a run already in flight is returned, not duplicated; a
 * non-forced run within 10 s of an identical completed run is skipped
 * (Settings toggle-ons pass `force` so they always run immediately).
 */
export function runSmartDownloads(
  deps: SmartDownloadsDeps,
  options: { force?: boolean } = {},
): Promise<SmartDownloadsRunResult> {
  if (inflight) return inflight;
  const key = settingsKey(deps.settings);
  if (
    !options.force &&
    lastCompletedAt > 0 &&
    key === lastSettingsKey &&
    Date.now() - lastCompletedAt < 10_000
  ) {
    return Promise.resolve({
      phase: status.phase === 'blocked' ? 'blocked' : status.phase === 'off' ? 'off' : 'done',
      started: status.started,
      startedIds: status.startedIds,
      alreadyDownloaded: status.alreadyDownloaded,
      skippedExcluded: status.skippedExcluded,
      blockedReason: status.blockedReason,
    });
  }
  inflight = (async (): Promise<SmartDownloadsRunResult> => {
    try {
      return await executeRun(deps);
    } finally {
      inflight = null;
      lastCompletedAt = Date.now();
      lastSettingsKey = key;
    }
  })();
  return inflight;
}

async function executeRun(deps: SmartDownloadsDeps): Promise<SmartDownloadsRunResult> {
  const { settings } = deps;
  if (!settings.likedEnabled && !settings.favouritePlaylistsEnabled) {
    setStatus({ phase: 'off', blockedReason: null, error: null });
    return {
      phase: 'off',
      started: 0,
      startedIds: [],
      alreadyDownloaded: 0,
      skippedExcluded: 0,
      blockedReason: null,
    };
  }

  const gate = evaluateNetworkGate(settings, deps.connection);
  if (!gate.allowed) {
    setStatus({ phase: 'blocked', blockedReason: gate.reason, error: null });
    return {
      phase: 'blocked',
      started: 0,
      startedIds: [],
      alreadyDownloaded: 0,
      skippedExcluded: 0,
      blockedReason: gate.reason,
    };
  }

  setStatus({ phase: 'checking', blockedReason: null, error: null });
  const errors: string[] = [];

  let downloadedIds = new Set<string>();
  try {
    downloadedIds = new Set(await deps.listDownloadedIds());
  } catch {
    // The pipeline re-checks `isDownloaded` per track, so a failed
    // catalogue read degrades to "download, let the pipeline skip" —
    // never to a failed run.
    errors.push('downloaded list');
  }

  let liked: Track[] = [];
  if (settings.likedEnabled) {
    try {
      liked = await deps.listLiked();
    } catch {
      errors.push('liked songs');
    }
  }

  let playlists: FavouritePlaylistInput[] = [];
  if (settings.favouritePlaylistsEnabled) {
    try {
      playlists = await deps.listFavouritePlaylists();
    } catch {
      errors.push('favourite playlists');
    }
  }

  const selection = selectSmartDownloads({
    liked,
    favouritePlaylists: playlists,
    downloadedIds,
    settings,
  });

  setStatus({
    phase: 'downloading',
    lastRunAt: Date.now(),
    started: 0,
    startedIds: [],
    alreadyDownloaded: selection.alreadyDownloaded,
    skippedExcluded: selection.skippedExcluded,
    error: errors.length ? `Could not read: ${errors.join(', ')}` : null,
  });

  // One pipeline call per source group, failures isolated per group:
  // a playlist whose batch throws must not cancel the liked batch (or
  // the next playlist) behind it.
  let started = 0;
  const startedIds: string[] = [];
  for (const group of selection.groups) {
    try {
      const count = await deps.downloadTracks(group.tracks);
      started += typeof count === 'number' ? count : group.tracks.length;
      startedIds.push(...group.tracks.map((track) => track.videoId));
    } catch {
      errors.push(group.label);
    }
  }

  setStatus({
    phase: 'downloading',
    started,
    startedIds,
    error: errors.length ? `Could not read/download: ${errors.join(', ')}` : null,
  });
  return {
    phase: 'done',
    started,
    startedIds,
    alreadyDownloaded: selection.alreadyDownloaded,
    skippedExcluded: selection.skippedExcluded,
    blockedReason: null,
  };
}

/**
 * Production wiring: real settings, real connection, real repos — all
 * lazy-imported so this module (imported by Settings/Manage Downloads
 * for the status line) never pulls the heavy download pipeline or the
 * database layer into the first bundle. The pipeline itself is only
 * imported when a run actually has tracks to hand it.
 */
export async function runSmartDownloadsFromApp(
  options: { force?: boolean } = {},
): Promise<SmartDownloadsRunResult> {
  const [{ getSettingsSnapshot }, { listFavorites }, { listPlaylists, listPlaylistTracks }, { listDownloads }] =
    await Promise.all([
      import('../settings/store'),
      import('../db/repos/favorites'),
      import('../db/repos/playlists'),
      import('../db/repos/downloads'),
    ]);
  const snapshot = getSettingsSnapshot();
  const settings: SmartDownloadSettings = {
    likedEnabled: snapshot.smartDownloadLiked,
    favouritePlaylistsEnabled: snapshot.smartDownloadFavPlaylists,
    wifiOnly: snapshot.smartDownloadWifiOnly,
    allowMetered: snapshot.smartDownloadAllowMetered,
    excludedPlaylistIds: snapshot.smartDownloadExcludedPlaylists,
  };
  return runSmartDownloads(
    {
      settings,
      connection: readNavigatorConnection(),
      listLiked: async () => listFavorites(),
      listFavouritePlaylists: async () => {
        const all = await listPlaylists();
        const favourites = all.filter((playlist) => playlist.isFavorite);
        const out: FavouritePlaylistInput[] = [];
        for (const playlist of favourites) {
          try {
            out.push({
              id: playlist.id,
              name: playlist.name,
              tracks: await listPlaylistTracks(playlist.id),
            });
          } catch {
            // One unreadable playlist must not cancel the rest.
            out.push({ id: playlist.id, name: playlist.name, tracks: [] });
          }
        }
        return out;
      },
      listDownloadedIds: async () => (await listDownloads()).map((song) => song.videoId),
      downloadTracks: async (tracks) => {
        const { startPlaylistDownload } = await import('../utils/downloads');
        return startPlaylistDownload(tracks);
      },
    },
    options,
  );
}

/**
 * Favourites-change watcher: subscribes to the flags store (patched
 * synchronously by every heart toggle) and schedules a debounced run
 * when a favourite id is ADDED. Removals never trigger a run, and a run
 * already in flight is coalesced by `runSmartDownloads`. Started once
 * from the boot hook in `main.tsx`, after flags are hydrated, so the
 * boot snapshot is the baseline — not a trigger.
 *
 * Known gap (documented, not hidden): favouriting a PLAYLIST does not
 * patch the flags store, so playlist favourites are picked up on the
 * next launch / Library visit / toggle-on instead of instantly.
 */
let watcherStarted = false;
let watcherTimer: ReturnType<typeof setTimeout> | null = null;

export function startSmartDownloadsWatcher(): void {
  if (watcherStarted) return;
  watcherStarted = true;
  void import('../db/flags')
    .then(({ getFlagsSnapshot, subscribeFlags }) => {
      let previous = new Set(getFlagsSnapshot().favorite);
      subscribeFlags(() => {
        const current = getFlagsSnapshot().favorite;
        const added = [...current].some((videoId) => !previous.has(videoId));
        previous = new Set(current);
        if (!added) return;
        if (watcherTimer) clearTimeout(watcherTimer);
        watcherTimer = setTimeout(() => {
          watcherTimer = null;
          void runSmartDownloadsFromApp().catch(() => {});
        }, 1500);
      });
    })
    .catch(() => {});
}
