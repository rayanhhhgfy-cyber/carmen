/**
 * Tests for the Daily Mix: determinism, date-keyed refresh,
 * force-refresh, and explainability labels.
 */
import { describe, expect, it } from 'vitest';

import type { Track } from '../types/models';
import {
  createMemoryStorage,
  generateDailyMix,
  getDailyMix,
  seededShuffle,
  todayKey,
  topArtist,
  type DailyMixInput,
} from './dailyMix';

function track(
  videoId: string,
  title: string,
  artist: string,
): Track {
  return {
    videoId,
    title,
    artists: [artist],
    artist,
    album: null,
    albumName: '',
    duration: '3:00',
    durationSeconds: 180,
    artwork: null,
    year: null,
    releaseDate: null,
    isExplicit: false,
    playlistId: null,
  };
}

const favorites = [
  track('fav1', 'Song One', 'Artist A'),
  track('fav2', 'Song Two', 'Artist A'),
  track('fav3', 'Song Three', 'Artist B'),
];
const library = [
  track('lib1', 'Library One', 'Artist A'),
  track('lib2', 'Library Two', 'Artist C'),
  track('lib3', 'Library Three', 'Artist C'),
];
const input: DailyMixInput = { favorites, library };

describe('generateDailyMix determinism', () => {
  it('produces the identical mix for the same day + library, twice', () => {
    const first = generateDailyMix(input, '2026-10-24');
    const second = generateDailyMix(input, '2026-10-24');
    expect(second).toEqual(first);
  });

  it('carries the same tracks regardless of input order (seed comes from sorted ids)', () => {
    const reordered: DailyMixInput = {
      favorites: [...favorites].reverse(),
      library: [...library].reverse(),
    };
    const base = generateDailyMix(input, '2026-10-24');
    const moved = generateDailyMix(reordered, '2026-10-24');
    expect(moved.sections.map((s) => s.id)).toEqual(base.sections.map((s) => s.id));
    for (const section of base.sections) {
      const twin = moved.sections.find((s) => s.id === section.id);
      expect([...(twin?.tracks.map((t) => t.videoId) ?? [])].sort()).toEqual(
        [...section.tracks.map((t) => t.videoId)].sort(),
      );
    }
  });

  it('seededShuffle is deterministic and a permutation', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(seededShuffle(items, 42)).toEqual(seededShuffle(items, 42));
    expect([...seededShuffle(items, 42)].sort()).toEqual(items);
  });

  it('never repeats a track across sections', () => {
    const mix = generateDailyMix(
      {
        favorites,
        library,
        relatedBySeed: { fav1: [track('rel1', 'Related One', 'Artist D'), favorites[0]] },
      },
      '2026-10-24',
    );
    const ids = mix.sections.flatMap((section) => section.tracks.map((t) => t.videoId));
    expect(new Set(ids).size).toBe(ids.length);
    expect(mix.totalTracks).toBe(ids.length);
  });
});

describe('generateDailyMix explainability', () => {
  it('every section carries a non-empty reason naming its signal', () => {
    const mix = generateDailyMix(
      {
        favorites,
        library,
        relatedBySeed: { fav1: [track('rel1', 'Related One', 'Artist D')] },
      },
      '2026-10-24',
    );
    expect(mix.sections.length).toBeGreaterThan(0);
    for (const section of mix.sections) {
      expect(section.reason.trim().length).toBeGreaterThan(0);
      expect(section.title.trim().length).toBeGreaterThan(0);
    }
    const titles = mix.sections.map((s) => s.title);
    expect(titles).toContain('From your favourites');
    expect(titles).toContain('Because you liked Artist A');
    expect(titles).toContain('More like Song One');
    expect(titles).toContain('From your library');
    const moreLike = mix.sections.find((s) => s.id === 'more-like');
    expect(moreLike?.reason).toContain('Song One');
    const liked = mix.sections.find((s) => s.id === 'liked-artist');
    expect(liked?.reason).toContain('Artist A');
  });

  it('an empty library yields an empty mix, never invented tracks', () => {
    const mix = generateDailyMix({ favorites: [], library: [] }, '2026-10-24');
    expect(mix.sections).toEqual([]);
    expect(mix.totalTracks).toBe(0);
  });

  it('topArtist breaks ties alphabetically', () => {
    expect(topArtist([track('a', 'One', 'Zebra'), track('b', 'Two', 'Apple')])).toBe('Apple');
    expect(topArtist([track('a', 'One', 'Unknown artist')])).toBeNull();
  });
});

describe('getDailyMix date-keyed cache', () => {
  it('reuses the cached mix for the same day even if the library changed', () => {
    const storage = createMemoryStorage();
    const first = getDailyMix(input, { dateKey: '2026-10-24', storage });
    const bigger: DailyMixInput = {
      favorites: [...favorites, track('fav9', 'Brand New', 'Artist Z')],
      library,
    };
    const second = getDailyMix(bigger, { dateKey: '2026-10-24', storage });
    expect(second).toEqual(first);
  });

  it('refreshes on a new day (and the new day mix is itself deterministic)', () => {
    const storage = createMemoryStorage();
    getDailyMix(input, { dateKey: '2026-10-24', storage });
    const second = getDailyMix(input, { dateKey: '2026-10-25', storage });
    expect(second.date).toBe('2026-10-25');
    expect(second).toEqual(generateDailyMix(input, '2026-10-25'));
    // The new day's mix is now the cached one.
    expect(getDailyMix(input, { dateKey: '2026-10-25', storage })).toEqual(second);
  });

  it('force-refresh regenerates for the same day and picks up new tracks', () => {
    const storage = createMemoryStorage();
    getDailyMix(input, { dateKey: '2026-10-24', storage });
    const bigger: DailyMixInput = {
      favorites: [...favorites, track('fav9', 'Brand New', 'Artist Z')],
      library,
    };
    const refreshed = getDailyMix(bigger, { force: true, dateKey: '2026-10-24', storage });
    const ids = refreshed.sections.flatMap((s) => s.tracks.map((t) => t.videoId));
    expect(ids).toContain('fav9');
    // The refreshed mix is now the cached one for the day.
    expect(getDailyMix(bigger, { dateKey: '2026-10-24', storage })).toEqual(refreshed);
  });

  it('does not serve a stale empty mix once the library has tracks', () => {
    const storage = createMemoryStorage();
    const empty = getDailyMix({ favorites: [], library: [] }, { dateKey: '2026-10-24', storage });
    expect(empty.totalTracks).toBe(0);
    const filled = getDailyMix(input, { dateKey: '2026-10-24', storage });
    expect(filled.totalTracks).toBeGreaterThan(0);
  });

  it('todayKey formats the local date', () => {
    expect(todayKey(new Date(2026, 9, 24, 12, 0, 0))).toBe('2026-10-24');
  });
});
