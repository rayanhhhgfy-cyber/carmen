/**
 * Unit tests for the TypeScript port of `server/matching.py`.
 *
 * The expectations are ported from `server/tests/test_matching.py` —
 * statuses exact, scores within a small epsilon where the Python tests
 * assert numbers (the Python values were re-verified against the real
 * module when this port was written).
 */
import { describe, expect, it } from 'vitest';

import {
  APPROXIMATE_THRESHOLD,
  MATCHED_THRESHOLD,
  artistSimilarity,
  buildSearchQueries,
  durationScore,
  matchTrack,
  normalizeText,
  scoreCandidate,
  similarity,
  statusForScore,
  ytmArtistNames,
  ytmDurationSeconds,
  type MatchableTrack,
} from './matching';
import type { SourceTrackInfo } from './spotifyConvert';

function spTrack(
  title = 'Blinding Lights',
  artists: string[] = ['The Weeknd'],
  durationMs: number | null = 202_000,
): MatchableTrack {
  return { title, artists, duration_ms: durationMs };
}

function ytmItem(
  title = 'Blinding Lights',
  artists: string[] = ['The Weeknd'],
  duration: string | null = '3:22',
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    videoId: 'abc123',
    title,
    artists: artists.map((name) => ({ name })),
    duration,
    thumbnails: [{ url: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg' }],
    ...extra,
  };
}

/* ── normalization ────────────────────────────────────────────────────── */

describe('normalizeText', () => {
  it.each([
    ['Blinding Lights', 'blinding lights'],
    ['Beyoncé', 'beyonce'],
    ['Halo (Remastered)', 'halo'],
    ['Song [Live]', 'song'],
    ['Bohemian Rhapsody - Remastered 2011', 'bohemian rhapsody'],
    ['  Hello   World  ', 'hello world'],
    ['Rock & Roll!', 'rock roll'],
    ['', ''],
    [null, ''],
  ])('normalizes %s → %s', (raw, expected) => {
    expect(normalizeText(raw as string | null)).toBe(expected);
  });

  it('strips bare feat. suffixes', () => {
    expect(normalizeText('Levitating feat. Dua Lipa')).toBe('levitating');
    expect(normalizeText('Song ft. Someone')).toBe('song');
    expect(normalizeText('Song featuring Someone Else')).toBe('song');
  });
});

describe('similarity', () => {
  it('matches the Python basics', () => {
    expect(similarity('Hello', 'hello')).toBe(1);
    expect(similarity('abc', 'xyz')).toBeLessThan(0.5);
    expect(similarity('', 'x')).toBe(0);
    expect(similarity(null, null)).toBe(0);
  });

  it('fast-lanes multi-token containment ("Single" suffix)', () => {
    expect(similarity('Blinding Lights', 'Blinding Lights - Single')).toBeGreaterThanOrEqual(0.9);
  });

  it('does not fast-lane single-token titles', () => {
    expect(similarity('Up', 'Stand Up')).toBeLessThan(0.9);
    expect(similarity('Up', 'Stand Up')).toBeCloseTo(0.4, 5);
  });
});

/* ── artist extraction / similarity ───────────────────────────────────── */

describe('ytmArtistNames', () => {
  it('reads every shape', () => {
    expect(ytmArtistNames({ artists: [{ name: 'A' }, { name: 'B' }] })).toEqual(['A', 'B']);
    expect(ytmArtistNames({ artists: ['A', 'B'] })).toEqual(['A', 'B']);
    expect(ytmArtistNames({ artists: [{ name: 'A' }], artist: 'A' })).toEqual(['A']);
    expect(ytmArtistNames({ artist: 'Solo' })).toEqual(['Solo']);
    expect(ytmArtistNames({})).toEqual([]);
  });
});

describe('artistSimilarity', () => {
  it('gives the containment bonus ("The Beatles" vs "Beatles")', () => {
    expect(artistSimilarity(['The Beatles'], ytmItem('x', ['Beatles']))).toBeGreaterThanOrEqual(0.9);
    expect(artistSimilarity(['Queen'], ytmItem('x', ['Queen']))).toBe(1);
    expect(artistSimilarity(['Queen'], ytmItem('x', ['ABBA']))).toBeLessThan(0.5);
    expect(artistSimilarity([], ytmItem())).toBe(0);
  });

  it('credits collaboration overlap', () => {
    const score = artistSimilarity(['KAROL G', 'Judeline', 'rusowsky'], ytmItem('x', ['KAROL G']));
    expect(score).toBeGreaterThanOrEqual(0.6);
    expect(score).toBeCloseTo(1, 5);
  });

  it('splits collaboration strings', () => {
    expect(artistSimilarity(['Shakira'], ytmItem('x', ['Shakira, Bizarrap']))).toBeGreaterThanOrEqual(0.6);
  });

  it('has no false friends', () => {
    expect(artistSimilarity(['Adele'], ytmItem('x', ['Someone Else']))).toBeLessThan(0.5);
  });
});

/* ── durations ────────────────────────────────────────────────────────── */

describe('durations', () => {
  it('reads every duration shape', () => {
    expect(ytmDurationSeconds({ duration: '3:22' })).toBe(202);
    expect(ytmDurationSeconds({ duration_seconds: 202 })).toBe(202);
    expect(ytmDurationSeconds({})).toBeNull();
  });

  it('scores closeness, neutral when unknown', () => {
    expect(durationScore(202_000, ytmItem('x', ['A'], '3:22'))).toBeCloseTo(1, 5);
    expect(durationScore(202_000, ytmItem('x', ['A'], '3:52'))).toBeCloseTo(0, 5);
    expect(durationScore(202_000, {})).toBe(0.5);
    expect(durationScore(0, ytmItem())).toBe(0.5);
    expect(durationScore(null, ytmItem())).toBe(0.5);
  });
});

/* ── scoring ──────────────────────────────────────────────────────────── */

describe('scoreCandidate / statusForScore', () => {
  it('scores a perfect match at the matched threshold or above', () => {
    const score = scoreCandidate(spTrack(), ytmItem());
    expect(score).toBeGreaterThanOrEqual(MATCHED_THRESHOLD);
    expect(score).toBeCloseTo(1, 5);
  });

  it('zeroes a wrong title (title floor)', () => {
    expect(scoreCandidate(spTrack(), ytmItem('Completely Different Song'))).toBe(0);
  });

  it('drops a wrong artist to the approximate band', () => {
    const score = scoreCandidate(spTrack(), ytmItem('Blinding Lights', ['Leonard Cohen']));
    expect(score).toBeGreaterThanOrEqual(APPROXIMATE_THRESHOLD);
    expect(score).toBeLessThan(MATCHED_THRESHOLD);
    // Python: 0.7782608695652175
    expect(score).toBeCloseTo(0.7783, 3);
  });

  it('still matches a remastered title', () => {
    const score = scoreCandidate(
      spTrack('Bohemian Rhapsody - Remastered 2011', ['Queen'], 355_000),
      ytmItem('Bohemian Rhapsody', ['Queen'], '5:55'),
    );
    expect(score).toBeGreaterThanOrEqual(MATCHED_THRESHOLD);
  });

  it('prefers the original over a cover', () => {
    const track = spTrack('Hallelujah', ['Jeff Buckley'], 413_000);
    const original = ytmItem('Hallelujah', ['Jeff Buckley'], '6:53');
    const cover = ytmItem('Hallelujah', ['Random Cover Artist'], '6:53');
    expect(scoreCandidate(track, original)).toBeGreaterThan(scoreCandidate(track, cover));
    expect(scoreCandidate(track, original)).toBeGreaterThanOrEqual(MATCHED_THRESHOLD);
  });

  it('maps scores to statuses at the exact thresholds', () => {
    expect(statusForScore(0.95)).toBe('matched');
    expect(statusForScore(MATCHED_THRESHOLD)).toBe('matched');
    expect(statusForScore(0.6)).toBe('approximate');
    expect(statusForScore(APPROXIMATE_THRESHOLD)).toBe('approximate');
    expect(statusForScore(0.2)).toBe('not_found');
  });
});

/* ── match loop ───────────────────────────────────────────────────────── */

describe('matchTrack', () => {
  it('picks the best candidate and stops after one query', async () => {
    const queries: string[] = [];
    const search = async (query: string) => {
      queries.push(query);
      return [
        ytmItem('Blinding Lights (Cover)', ['Someone Else'], '3:30'),
        ytmItem('Blinding Lights', ['The Weeknd'], '3:22'),
      ];
    };
    const result = await matchTrack(spTrack(), search);
    expect(result.status).toBe('matched');
    expect(result.match?.artists).toEqual([{ name: 'The Weeknd' }]);
    expect(result.confidence).toBeGreaterThanOrEqual(MATCHED_THRESHOLD);
    expect(queries).toEqual(['Blinding Lights The Weeknd']);
  });

  it('falls back to the title-only query', async () => {
    const queries: string[] = [];
    const search = async (query: string) => {
      queries.push(query);
      if (query.includes('The Weeknd')) return [ytmItem('Unrelated Song', ['Nobody'])];
      return [ytmItem('Blinding Lights', ['The Weeknd'], '3:22')];
    };
    const result = await matchTrack(spTrack(), search);
    expect(result.status).toBe('matched');
    expect(queries).toEqual(['Blinding Lights The Weeknd', 'Blinding Lights']);
  });

  it('reports not_found when nothing is close', async () => {
    const search = async () => [ytmItem('Totally Different', ['Nobody'])];
    const result = await matchTrack(spTrack(), search);
    expect(result.status).toBe('not_found');
    expect(result.match).toBeNull();
    expect(result.confidence).toBeLessThan(APPROXIMATE_THRESHOLD);
  });

  it('survives search errors', async () => {
    const search = async (): Promise<Record<string, unknown>[]> => {
      throw new Error('ytm exploded');
    };
    const result = await matchTrack(spTrack(), search);
    expect(result.status).toBe('not_found');
    expect(result.match).toBeNull();
  });

  it('retries with the normalized title', async () => {
    const queries: string[] = [];
    const search = async (query: string) => {
      queries.push(query);
      if (query.startsWith('Bohemian Rhapsody - Remastered')) {
        return [ytmItem('Some Other Song', ['Nobody'])];
      }
      return [ytmItem('Bohemian Rhapsody', ['Queen'], '5:55')];
    };
    const track = spTrack('Bohemian Rhapsody - Remastered 2011', ['Queen'], 355_000);
    const result = await matchTrack(track, search);
    expect(result.status).toBe('matched');
    expect(result.match?.title).toBe('Bohemian Rhapsody');
    expect(queries[0]).toBe('Bohemian Rhapsody - Remastered 2011 Queen');
    expect(queries[1]).toBe('bohemian rhapsody Queen');
  });

  it('stops at a confident match (no extra searches)', async () => {
    const queries: string[] = [];
    const search = async (query: string) => {
      queries.push(query);
      return [ytmItem()];
    };
    const result = await matchTrack(spTrack(), search);
    expect(result.status).toBe('matched');
    expect(queries).toEqual(['Blinding Lights The Weeknd']);
  });

  it('builds the query cascade like the server', () => {
    expect(buildSearchQueries(spTrack())).toEqual([
      'Blinding Lights The Weeknd',
      'Blinding Lights',
    ]);
    const source: SourceTrackInfo = {
      id: 's1',
      title: 'Song (Live)',
      artists: ['A', 'B'],
      artist: 'A, B',
      album: null,
      artwork: null,
      duration_ms: null,
      url: '',
      explicit: false,
      source: 'spotify-playlist',
    };
    expect(buildSearchQueries(source)).toEqual(['Song (Live) A', 'song A', 'Song (Live)']);
  });
});
