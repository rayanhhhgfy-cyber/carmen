/**
 * Listening stats — pure aggregation + the persisted play-history store.
 *
 * COUNTING RULE (the one rule, applied everywhere):
 *   A play counts when playback passes 30 seconds OR the track completes —
 *   whichever comes first. A track shorter than 30 seconds therefore counts
 *   on completion; a track skipped before 30 seconds (and before its end)
 *   never counts.
 *
 * ANTI-DOUBLE-COUNT RULE:
 *   One counted play per track-start session. A session starts when a track
 *   becomes current and ends when another track becomes current. Seeking
 *   backwards, rewinding, and repeat-one replays all stay inside the same
 *   session, so they can never count the same play twice; the store
 *   additionally refuses a second record with the same session key, so even
 *   a double-fired effect (StrictMode, `ended` + watchdog) is harmless.
 *   Playing the same track again *after another track* is a new session and
 *   legitimately counts again.
 *
 * STORAGE — the EXISTING layer, no second store:
 *   Records live in the app KV store (`services/storage` — IndexedDB via
 *   Dexie with a localStorage mirror, hydrated before first render in
 *   `main.tsx`), under one key, as a plain JSON array. Nothing here opens
 *   its own Dexie/SQLite/localStorage bucket, and no schema migration is
 *   needed. Reads are synchronous (`kvRead` serves the hydrated memory
 *   cache), so the stats page never awaits storage.
 *
 * MINUTES — what "total listening minutes" actually sums:
 *   Each counted play records `listenedSeconds`: the furthest playhead
 *   reached during that session, capped at the track's known duration
 *   (30 at the moment the 30-second threshold fires, growing as playback
 *   continues, the full duration on completion). Minutes are the sum of
 *   those per-play figures — real listened time, not "plays × full length",
 *   which would over-count every track skipped at 0:31.
 *
 * GENRE — deliberately absent:
 *   Carmen's normalized `Track` shape carries no genre (`TrackMeta.genre`
 *   exists only on the enriched, optionally-fetched metadata payload, which
 *   the player hook must not depend on). Wrapped therefore omits a
 *   favourite genre rather than inventing one.
 */
import { useSyncExternalStore } from 'react';

import { kvRead, kvWrite } from '../services/storage';
import type { Artist, Track } from '../types/models';

/** Seconds of playback after which any track counts as played. */
export const COUNT_THRESHOLD_SECONDS = 30;

/** KV key for the whole history (one JSON array — see the header note). */
export const PLAY_HISTORY_KEY = 'playHistory.v1';

/** Oldest records are dropped past this — keeps the KV row small. */
export const MAX_PLAY_RECORDS = 2000;

/** One counted play, as stored. */
export interface PlayRecord {
  /** `${videoId}:${sessionStartedAtMs}` — the anti-double-count key. */
  sessionKey: string;
  videoId: string;
  title: string;
  /** Credited artists (empty when the track carries no usable artist). */
  artists: string[];
  artist: string;
  artwork: string | null;
  albumName: string;
  durationSeconds: number | null;
  /** Epoch ms of the track-start session this play belongs to. */
  playedAt: number;
  /**
   * Furthest playhead reached in the session, capped at the duration.
   * Starts at the count moment (30, or the duration on a short-track
   * completion) and only ever grows while the session continues.
   */
  listenedSeconds: number;
}

/** A track-start session in flight — the unit the hook tracks. */
export interface PlaySession {
  sessionKey: string;
  videoId: string;
  startedAt: number;
  /** True once this session has produced its (single) counted play. */
  counted: boolean;
  /** Furthest playhead reached so far, capped at the duration. */
  maxPosition: number;
}

/** Starts a session for a track that just became current. */
export function startPlaySession(track: Track, now: number): PlaySession {
  return {
    sessionKey: `${track.videoId}:${now}`,
    videoId: track.videoId,
    startedAt: now,
    counted: false,
    maxPosition: 0,
  };
}

export interface SessionAdvance {
  session: PlaySession;
  /** True only on the single tick where this session first counts. */
  newlyCounted: boolean;
}

/**
 * Feeds one playhead observation into a session.
 *
 * `position` is the element's currentTime; `duration` the authoritative
 * metadata length (0/unknown when the track carries none); `ended` is true
 * only for the element's own `ended` event. Seeking backwards only lowers
 * `position` — `maxPosition` never moves back, and `counted` never resets,
 * which is exactly what makes seek/replay/restart double-count-proof.
 */
export function advancePlaySession(
  session: PlaySession,
  observation: { position: number; duration: number; ended?: boolean },
): SessionAdvance {
  const position = Number.isFinite(observation.position) ? Math.max(0, observation.position) : 0;
  const duration = Number.isFinite(observation.duration) ? Math.max(0, observation.duration) : 0;
  const capped = duration > 0 ? Math.min(position, duration) : position;
  const completed =
    observation.ended === true || (duration > 0 && position >= duration - 0.5);
  const next: PlaySession = {
    ...session,
    maxPosition: Math.max(session.maxPosition, capped),
  };
  if (!session.counted && (position >= COUNT_THRESHOLD_SECONDS || completed)) {
    next.counted = true;
    return { session: next, newlyCounted: true };
  }
  return { session: next, newlyCounted: false };
}

/** Artist names off a normalized track (array first, display string fallback). */
export function trackArtistNames(track: Track): string[] {
  const fromArray = (Array.isArray(track.artists) ? track.artists : [])
    .map((artist: Artist) => (typeof artist === 'string' ? artist : artist?.name))
    .map((name) => (name ?? '').trim())
    .filter(Boolean);
  if (fromArray.length) return fromArray;
  const single = (track.artist ?? '').trim();
  if (single && single !== 'Unknown artist') return [single];
  return [];
}

/** Builds the stored record for a session that just counted. */
export function sessionToRecord(track: Track, session: PlaySession): PlayRecord {
  return {
    sessionKey: session.sessionKey,
    videoId: track.videoId,
    title: track.title,
    artists: trackArtistNames(track),
    artist: track.artist,
    artwork: track.artwork,
    albumName: track.albumName,
    durationSeconds: track.durationSeconds,
    playedAt: session.startedAt,
    listenedSeconds: session.maxPosition,
  };
}

/** Rebuilds a playable normalized track from a stored record. */
export function recordToTrack(record: PlayRecord): Track {
  return {
    videoId: record.videoId,
    title: record.title,
    artists: record.artists,
    artist: record.artist || 'Unknown artist',
    album: record.albumName ? { name: record.albumName, id: null } : null,
    albumName: record.albumName,
    duration: null,
    durationSeconds: record.durationSeconds,
    artwork: record.artwork,
    year: null,
    releaseDate: null,
    isExplicit: false,
    playlistId: null,
  };
}

// ── Store (KV-backed, reactive via a version counter) ─────────────────────

function sanitizeRecords(raw: unknown): PlayRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is PlayRecord =>
      Boolean(entry) &&
      typeof (entry as PlayRecord).sessionKey === 'string' &&
      typeof (entry as PlayRecord).videoId === 'string' &&
      Number.isFinite((entry as PlayRecord).playedAt) &&
      Number.isFinite((entry as PlayRecord).listenedSeconds),
  );
}

let version = 0;
const listeners = new Set<() => void>();

function notify(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

export function subscribePlayStats(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getStatsVersion(): number {
  return version;
}

/** All counted plays, newest last (the KV row is the source of truth). */
export function getPlayRecords(): PlayRecord[] {
  return sanitizeRecords(kvRead<unknown>(PLAY_HISTORY_KEY, []));
}

/**
 * Appends a counted play — unless a record with the same session key is
 * already stored (the second half of the anti-double-count guarantee).
 */
export function recordCountedPlay(record: PlayRecord): boolean {
  const records = getPlayRecords();
  if (records.some((entry) => entry.sessionKey === record.sessionKey)) return false;
  records.push(record);
  kvWrite(PLAY_HISTORY_KEY, records.slice(-MAX_PLAY_RECORDS));
  notify();
  return true;
}

/**
 * Raises a counted play's listened time as its session continues.
 * Only ever grows, and never past the track's known duration.
 */
export function updateCountedPlaySeconds(sessionKey: string, listenedSeconds: number): void {
  const records = getPlayRecords();
  const entry = records.find((record) => record.sessionKey === sessionKey);
  if (!entry) return;
  const cap =
    entry.durationSeconds && entry.durationSeconds > 0
      ? Math.min(listenedSeconds, entry.durationSeconds)
      : listenedSeconds;
  if (!Number.isFinite(cap) || cap <= entry.listenedSeconds) return;
  entry.listenedSeconds = cap;
  kvWrite(PLAY_HISTORY_KEY, records);
  notify();
}

/** Live record list for React — re-renders on every stats write. */
export function usePlayRecords(): PlayRecord[] {
  useSyncExternalStore(subscribePlayStats, getStatsVersion, getStatsVersion);
  return getPlayRecords();
}

// ── Aggregation (pure — every function takes records + `now`) ─────────────

export type StatsWindow = '7d' | '30d' | 'all';

export const STATS_WINDOW_DAYS: Record<StatsWindow, number | null> = {
  '7d': 7,
  '30d': 30,
  all: null,
};

/** Plays whose session started inside the window (boundary inclusive). */
export function filterByWindow(
  records: PlayRecord[],
  window: StatsWindow,
  now: number,
): PlayRecord[] {
  const days = STATS_WINDOW_DAYS[window];
  if (days === null) return [...records];
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return records.filter((record) => record.playedAt >= cutoff);
}

/** Total listening minutes in the given plays (1 decimal, see header). */
export function totalMinutes(records: PlayRecord[]): number {
  const seconds = records.reduce(
    (sum, record) => sum + (Number.isFinite(record.listenedSeconds) ? record.listenedSeconds : 0),
    0,
  );
  return Math.round((seconds / 60) * 10) / 10;
}

export interface TopTrack {
  videoId: string;
  title: string;
  artist: string;
  artwork: string | null;
  plays: number;
  minutes: number;
  lastPlayedAt: number;
}

/** Most-played tracks: plays desc, then most-recent, then title. */
export function topTracks(records: PlayRecord[], limit = 10): TopTrack[] {
  const byId = new Map<string, TopTrack>();
  for (const record of records) {
    const entry = byId.get(record.videoId);
    if (entry) {
      entry.plays += 1;
      entry.minutes = Math.round((entry.minutes + record.listenedSeconds / 60) * 10) / 10;
      entry.lastPlayedAt = Math.max(entry.lastPlayedAt, record.playedAt);
    } else {
      byId.set(record.videoId, {
        videoId: record.videoId,
        title: record.title,
        artist: record.artist,
        artwork: record.artwork,
        plays: 1,
        minutes: Math.round((record.listenedSeconds / 60) * 10) / 10,
        lastPlayedAt: record.playedAt,
      });
    }
  }
  return [...byId.values()]
    .sort(
      (a, b) =>
        b.plays - a.plays || b.lastPlayedAt - a.lastPlayedAt || a.title.localeCompare(b.title),
    )
    .slice(0, limit);
}

export interface TopArtist {
  artist: string;
  plays: number;
  minutes: number;
}

/**
 * Most-played artists. A collaboration credits every credited artist with
 * the full play (and its minutes) — the same convention as chart tallies,
 * so artist minutes can sum to more than total minutes on collabs.
 */
export function topArtists(records: PlayRecord[], limit = 10): TopArtist[] {
  const byName = new Map<string, TopArtist>();
  for (const record of records) {
    for (const artist of record.artists) {
      const entry = byName.get(artist);
      if (entry) {
        entry.plays += 1;
        entry.minutes = Math.round((entry.minutes + record.listenedSeconds / 60) * 10) / 10;
      } else {
        byName.set(artist, {
          artist,
          plays: 1,
          minutes: Math.round((record.listenedSeconds / 60) * 10) / 10,
        });
      }
    }
  }
  return [...byName.values()]
    .sort((a, b) => b.plays - a.plays || a.artist.localeCompare(b.artist))
    .slice(0, limit);
}

/** Local calendar day key (`YYYY-M-D`) for a timestamp. */
export function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/**
 * Current listening streak: consecutive local days with ≥1 counted play.
 * Counts back from today; if today has no play yet, the streak is still
 * alive when yesterday has one (the day isn't over), so counting starts
 * there instead. A gap anywhere older breaks it; no plays at all → 0.
 */
export function currentStreak(records: PlayRecord[], now: number): number {
  const days = new Set(records.map((record) => dayKey(record.playedAt)));
  if (!days.size) return 0;
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  if (!days.has(dayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(dayKey(cursor.getTime()))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export interface StatsSummary {
  window: StatsWindow;
  plays: number;
  minutes: number;
  streak: number;
  tracks: TopTrack[];
  artists: TopArtist[];
}

/** One-call summary for a window (streak is always all-time). */
export function summarizeStats(
  records: PlayRecord[],
  window: StatsWindow,
  now: number,
): StatsSummary {
  const inWindow = filterByWindow(records, window, now);
  return {
    window,
    plays: inWindow.length,
    minutes: totalMinutes(inWindow),
    streak: currentStreak(records, now),
    tracks: topTracks(inWindow),
    artists: topArtists(inWindow),
  };
}

export interface WrappedSummary {
  totalPlays: number;
  totalMinutes: number;
  topTrack: TopTrack | null;
  topArtist: TopArtist | null;
  streak: number;
  /** Genre is NOT here on purpose — see the header note. */
}

/** All-time Wrapped summary; null when nothing has been counted yet. */
export function buildWrapped(records: PlayRecord[], now: number): WrappedSummary | null {
  if (!records.length) return null;
  const tracks = topTracks(records, 1);
  const artists = topArtists(records, 1);
  return {
    totalPlays: records.length,
    totalMinutes: totalMinutes(records),
    topTrack: tracks[0] ?? null,
    topArtist: artists[0] ?? null,
    streak: currentStreak(records, now),
  };
}
