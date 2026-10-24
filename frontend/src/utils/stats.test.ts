/**
 * Unit tests for listening stats (`utils/stats.ts`).
 *
 * The store runs against the in-memory KV mock (the pattern from
 * `db/repos/playlists.fallback.test` / `libraryBackup.test`): no Dexie, no
 * DOM, no player — the session machine and the aggregation are pure, and
 * the React hook (`hooks/usePlayStats.ts`) is only the thin glue that feeds
 * playhead ticks into them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { memKv } = vi.hoisted(() => ({
  memKv: new Map<string, unknown>(),
}));

vi.mock('../services/storage', () => ({
  kvRead: <T>(key: string, fallback: T): T =>
    (memKv.has(key) ? memKv.get(key) : fallback) as T,
  kvWrite: (key: string, value: unknown): void => {
    memKv.set(key, value);
  },
}));

import type { Track } from '../types/models';
import {
  advancePlaySession,
  buildWrapped,
  currentStreak,
  filterByWindow,
  getPlayRecords,
  recordCountedPlay,
  startPlaySession,
  summarizeStats,
  topArtists,
  topTracks,
  totalMinutes,
  updateCountedPlaySeconds,
  type PlayRecord,
} from './stats';

/** Fixed "now": Saturday 2026-10-24, noon local — day math stays in one TZ. */
const NOW = new Date(2026, 9, 24, 12, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

function track(videoId: string, title: string, artist = 'Artist'): Track {
  return {
    videoId,
    title,
    artists: [artist],
    artist,
    album: null,
    albumName: '',
    duration: null,
    durationSeconds: 200,
    artwork: null,
    year: null,
    releaseDate: null,
    isExplicit: false,
    playlistId: null,
  };
}

function record(
  sessionKey: string,
  videoId: string,
  playedAt: number,
  listenedSeconds = 120,
  title = videoId,
  artists: string[] = ['Artist'],
): PlayRecord {
  return {
    sessionKey,
    videoId,
    title,
    artists,
    artist: artists.join(', '),
    artwork: null,
    albumName: '',
    durationSeconds: 200,
    playedAt,
    listenedSeconds,
  };
}

beforeEach(() => {
  memKv.clear();
});

describe('windows', () => {
  const records = [
    record('s1', 'v1', NOW - 6 * DAY),
    record('s2', 'v2', NOW - 8 * DAY),
    record('s3', 'v3', NOW - 29 * DAY),
    record('s4', 'v4', NOW - 31 * DAY),
    record('s5', 'v5', NOW - 400 * DAY),
  ];

  it('7d keeps only the last 7 days, 30d the last 30, all keeps everything', () => {
    expect(filterByWindow(records, '7d', NOW).map((r) => r.videoId)).toEqual(['v1']);
    expect(filterByWindow(records, '30d', NOW).map((r) => r.videoId)).toEqual([
      'v1',
      'v2',
      'v3',
    ]);
    expect(filterByWindow(records, 'all', NOW)).toHaveLength(5);
  });

  it('the window boundary itself is inclusive', () => {
    const edge = [record('edge', 'vE', NOW - 7 * DAY)];
    expect(filterByWindow(edge, '7d', NOW)).toHaveLength(1);
    const justOutside = [record('out', 'vO', NOW - 7 * DAY - 1)];
    expect(filterByWindow(justOutside, '7d', NOW)).toHaveLength(0);
  });
});

describe('minutes and rankings', () => {
  it('total minutes sum listened seconds, not plays × full length', () => {
    const records = [
      record('a', 'v1', NOW, 30),
      record('b', 'v2', NOW, 90),
      record('c', 'v3', NOW, 240),
    ];
    expect(totalMinutes(records)).toBe(6);
  });

  it('top tracks rank by plays, ties break by most recent', () => {
    const records = [
      record('a1', 'v1', NOW - 2 * DAY, 120, 'Old Hit'),
      record('a2', 'v1', NOW - 1 * DAY, 120, 'Old Hit'),
      record('b1', 'v2', NOW, 120, 'New Hit'),
      record('b2', 'v2', NOW, 120, 'New Hit'),
      record('c1', 'v3', NOW, 120, 'Once'),
    ];
    const tops = topTracks(records);
    expect(tops.map((t) => t.videoId)).toEqual(['v2', 'v1', 'v3']);
    expect(tops[0].plays).toBe(2);
    expect(tops[2].plays).toBe(1);
  });

  it('top artists credit every credited artist; artist-less tracks rank nowhere', () => {
    const records = [
      record('a', 'v1', NOW, 120, 'Duet', ['A', 'B']),
      record('b', 'v2', NOW, 120, 'Solo', ['A']),
      record('c', 'v3', NOW, 120, 'Mystery', []),
    ];
    const tops = topArtists(records);
    expect(tops.map((t) => t.artist)).toEqual(['A', 'B']);
    expect(tops[0].plays).toBe(2);
    expect(tops[1].plays).toBe(1);
  });
});

describe('streak', () => {
  it('counts consecutive days ending today', () => {
    const records = [
      record('a', 'v1', NOW),
      record('b', 'v2', NOW - DAY),
      record('c', 'v3', NOW - 2 * DAY),
    ];
    expect(currentStreak(records, NOW)).toBe(3);
  });

  it('a gap breaks the streak', () => {
    const records = [record('a', 'v1', NOW), record('b', 'v2', NOW - 2 * DAY)];
    expect(currentStreak(records, NOW)).toBe(1);
  });

  it('no play today yet keeps yesterday’s streak alive', () => {
    const records = [record('a', 'v1', NOW - DAY), record('b', 'v2', NOW - 2 * DAY)];
    expect(currentStreak(records, NOW)).toBe(2);
  });

  it('no plays, or only stale plays, give a zero streak', () => {
    expect(currentStreak([], NOW)).toBe(0);
    expect(currentStreak([record('a', 'v1', NOW - 5 * DAY)], NOW)).toBe(0);
  });
});

describe('counting rule — one play per session, never twice', () => {
  it('skipping before 30 seconds never counts', () => {
    let session = startPlaySession(track('v1', 'One'), NOW);
    expect(advancePlaySession(session, { position: 10, duration: 200 }).newlyCounted).toBe(false);
    session = advancePlaySession(session, { position: 10, duration: 200 }).session;
    expect(advancePlaySession(session, { position: 29, duration: 200 }).newlyCounted).toBe(false);
  });

  it('passing 30 seconds counts exactly once, even after seek-back and replay', () => {
    let session = startPlaySession(track('v1', 'One'), NOW);
    let step = advancePlaySession(session, { position: 30, duration: 200 });
    expect(step.newlyCounted).toBe(true);
    session = step.session;
    // Seek back to the start and listen past 30 again: same session, no recount.
    step = advancePlaySession(session, { position: 5, duration: 200 });
    expect(step.newlyCounted).toBe(false);
    step = advancePlaySession(step.session, { position: 35, duration: 200 });
    expect(step.newlyCounted).toBe(false);
    // Repeat-one loop: rewind to 0, play to the end, again: still no recount.
    step = advancePlaySession(step.session, { position: 0, duration: 200 });
    step = advancePlaySession(step.session, { position: 199.6, duration: 200 });
    expect(step.newlyCounted).toBe(false);
    step = advancePlaySession(step.session, { position: 0, duration: 200, ended: true });
    expect(step.newlyCounted).toBe(false);
  });

  it('a track restart after another track is a new session and counts again', () => {
    const first = startPlaySession(track('v1', 'One'), NOW);
    const firstCounted = advancePlaySession(first, { position: 45, duration: 200 });
    expect(firstCounted.newlyCounted).toBe(true);
    const second = startPlaySession(track('v1', 'One'), NOW + 1000);
    expect(second.sessionKey).not.toBe(first.sessionKey);
    expect(advancePlaySession(second, { position: 31, duration: 200 }).newlyCounted).toBe(true);
  });

  it('a short track counts on completion below 30 seconds', () => {
    const session = startPlaySession(track('vS', 'Short'), NOW);
    const step = advancePlaySession(session, { position: 19.6, duration: 20 });
    expect(step.newlyCounted).toBe(true);
    expect(step.session.maxPosition).toBe(19.6);
  });

  it('the element ended event counts a completion even without a final tick', () => {
    const session = startPlaySession(track('v1', 'One'), NOW);
    const step = advancePlaySession(session, { position: 12, duration: 0, ended: true });
    expect(step.newlyCounted).toBe(true);
  });

  it('max position never moves backwards and never exceeds the duration', () => {
    let session = startPlaySession(track('v1', 'One'), NOW);
    session = advancePlaySession(session, { position: 40, duration: 30 }).session;
    expect(session.maxPosition).toBe(30);
    session = advancePlaySession(session, { position: 5, duration: 30 }).session;
    expect(session.maxPosition).toBe(30);
  });
});

describe('store', () => {
  it('refuses a second record with the same session key', () => {
    const entry = record('s1', 'v1', NOW);
    expect(recordCountedPlay(entry)).toBe(true);
    expect(recordCountedPlay(entry)).toBe(false);
    expect(recordCountedPlay({ ...entry, listenedSeconds: 999 })).toBe(false);
  });

  it('listened seconds only grow, and cap at the track duration', () => {
    recordCountedPlay(record('s1', 'v1', NOW, 30));
    updateCountedPlaySeconds('s1', 90);
    updateCountedPlaySeconds('s1', 50);
    updateCountedPlaySeconds('s1', 9999);
    updateCountedPlaySeconds('missing', 90);
    const stored = memKv.get('playHistory.v1') as PlayRecord[];
    expect(stored).toHaveLength(1);
    expect(stored[0].listenedSeconds).toBe(200);
  });

  it('junk in the KV row reads as an empty history, never a crash', () => {
    memKv.set('playHistory.v1', { not: 'an array' });
    expect(summarizeStats([], 'all', NOW).plays).toBe(0);
    // The store read itself (not the passed-in list) must also survive junk.
    expect(getPlayRecords()).toEqual([]);
  });
});

describe('wrapped', () => {
  it('is null with no plays, and summarizes all time otherwise', () => {
    expect(buildWrapped([], NOW)).toBeNull();
    const records = [
      record('a', 'v1', NOW - 300 * DAY, 180, 'Old Favourite', ['Singer']),
      record('b', 'v1', NOW, 180, 'Old Favourite', ['Singer']),
      record('c', 'v2', NOW, 60, 'Other', ['Band']),
    ];
    const wrapped = buildWrapped(records, NOW);
    expect(wrapped?.totalPlays).toBe(3);
    expect(wrapped?.totalMinutes).toBe(7);
    expect(wrapped?.topTrack?.videoId).toBe('v1');
    expect(wrapped?.topArtist?.artist).toBe('Singer');
    expect(wrapped?.streak).toBe(1);
  });

  it('summarizeStats combines window, minutes, streak and rankings', () => {
    const records = [
      record('a', 'v1', NOW, 120, 'Hit', ['Singer']),
      record('b', 'v2', NOW - 40 * DAY, 120, 'Ancient', ['Band']),
    ];
    const summary = summarizeStats(records, '30d', NOW);
    expect(summary.plays).toBe(1);
    expect(summary.minutes).toBe(2);
    expect(summary.streak).toBe(1);
    expect(summary.tracks.map((t) => t.videoId)).toEqual(['v1']);
    expect(summary.artists.map((t) => t.artist)).toEqual(['Singer']);
  });
});
