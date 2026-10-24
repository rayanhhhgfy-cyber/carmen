/**
 * Tests for Discover data mapping: the live payload shapes (captured
 * from GET /browsing/explore and GET /browsing/charts on 2026-10-24)
 * map to sections, and empty/missing payloads map to omitted sections
 * — never to invented content.
 */
import { describe, expect, it } from 'vitest';

import {
  mapChartsPayload,
  mapExplorePayload,
  mergeDiscoverPayloads,
} from './discover';

const exploreFixture = {
  trending: {
    playlist: 'VLOLAK5uy_example',
    items: [
      {
        title: 'Trending Song',
        videoId: 'trend123',
        artists: [{ name: 'Trend Artist', id: 'UCtrend' }],
        thumbnails: [{ url: 'https://i.ytimg.com/vi/trend123/hqdefault.jpg', width: 120, height: 90 }],
        views: '10M',
      },
      { title: 'No videoId here' },
    ],
  },
  new_releases: [
    {
      title: 'Fresh Album',
      artists: [{ id: 'UCartist', name: 'New Artist' }],
      browseId: 'MPREb_example',
      audioPlaylistId: 'OLAK5uy_example',
      thumbnails: [{ url: 'https://example.com/cover.jpg', width: 226, height: 226 }],
      isExplicit: false,
      type: 'Album',
    },
  ],
};

const chartsFixture = {
  countries: { selected: { text: 'Global' }, options: ['US', 'ZZ'] },
  videos: [
    { title: 'Top 100 Music Videos Global', playlistId: 'PLexample', thumbnails: [] },
  ],
  artists: [
    {
      title: 'Chart Artist One',
      browseId: 'UCchart1',
      subscribers: '2.3M',
      thumbnails: [{ url: 'https://example.com/a1.jpg', width: 60, height: 60 }],
      rank: '1',
      trend: 'neutral',
    },
    {
      title: 'Chart Artist Two',
      browseId: 'UCchart2',
      subscribers: '1.1M',
      thumbnails: [{ url: 'https://example.com/a2.jpg', width: 60, height: 60 }],
      rank: '2',
      trend: 'up',
    },
  ],
};

describe('mapExplorePayload', () => {
  it('maps trending items to normalized tracks, dropping id-less items', () => {
    const { trendingSongs, newReleases } = mapExplorePayload(exploreFixture);
    expect(trendingSongs).toHaveLength(1);
    expect(trendingSongs[0].videoId).toBe('trend123');
    expect(trendingSongs[0].title).toBe('Trending Song');
    expect(trendingSongs[0].artist).toBe('Trend Artist');
    expect(newReleases).toHaveLength(1);
    expect(newReleases[0].title).toBe('Fresh Album');
    expect(newReleases[0].artists).toBe('New Artist');
    expect(newReleases[0].browseId).toBe('MPREb_example');
    expect(newReleases[0].type).toBe('Album');
  });

  it('empty / missing payloads yield empty sections, not filler', () => {
    expect(mapExplorePayload(null)).toEqual({ trendingSongs: [], newReleases: [] });
    expect(mapExplorePayload({})).toEqual({ trendingSongs: [], newReleases: [] });
    expect(mapExplorePayload({ trending: {}, new_releases: null })).toEqual({
      trendingSongs: [],
      newReleases: [],
    });
  });
});

describe('mapChartsPayload', () => {
  it('maps ranked artists verbatim — ranks come from the payload, never invented', () => {
    const { trendingArtists, chartCountry } = mapChartsPayload(chartsFixture);
    expect(chartCountry).toBe('Global');
    expect(trendingArtists).toHaveLength(2);
    expect(trendingArtists[0]).toMatchObject({
      name: 'Chart Artist One',
      browseId: 'UCchart1',
      subscribers: '2.3M',
      rank: 1,
      trend: 'neutral',
    });
    expect(trendingArtists[1].rank).toBe(2);
    expect(trendingArtists[1].trend).toBe('up');
  });

  it('charts carries no songs — the mapper must not invent a songs list from it', () => {
    const mapped = mapChartsPayload(chartsFixture);
    expect(mapped).not.toHaveProperty('songs');
    expect(mapped).not.toHaveProperty('trendingSongs');
  });

  it('sorts by payload rank and tolerates a missing rank', () => {
    const { trendingArtists } = mapChartsPayload({
      artists: [
        { title: 'Second', browseId: 'UC2', rank: '2' },
        { title: 'Unranked', browseId: 'UC0' },
        { title: 'First', browseId: 'UC1', rank: '1' },
      ],
    });
    expect(trendingArtists.map((a) => a.name)).toEqual(['First', 'Second', 'Unranked']);
    expect(trendingArtists[2].rank).toBeNull();
  });

  it('empty / missing payloads yield empty sections', () => {
    expect(mapChartsPayload(null)).toEqual({ trendingArtists: [], chartCountry: null });
    expect(mapChartsPayload({})).toEqual({ trendingArtists: [], chartCountry: null });
  });
});

describe('mergeDiscoverPayloads', () => {
  it('merges both sources and tolerates one side failing', () => {
    const merged = mergeDiscoverPayloads(exploreFixture, chartsFixture);
    expect(merged.trendingSongs).toHaveLength(1);
    expect(merged.trendingArtists).toHaveLength(2);
    expect(merged.newReleases).toHaveLength(1);
    expect(merged.chartCountry).toBe('Global');

    const exploreOnly = mergeDiscoverPayloads(exploreFixture, null);
    expect(exploreOnly.trendingArtists).toEqual([]);
    expect(exploreOnly.trendingSongs).toHaveLength(1);

    const chartsOnly = mergeDiscoverPayloads(null, chartsFixture);
    expect(chartsOnly.trendingSongs).toEqual([]);
    expect(chartsOnly.trendingArtists).toHaveLength(2);
  });
});
