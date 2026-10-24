/**
 * Discover — "Best right now" from LIVE data only.
 *
 * Endpoint outcome, probed read-only against the configured demo API
 * (2026-10-24, `GET https://api-carmen-v1.syr.qzz.io/...`):
 *
 * - `GET /browsing/charts` — EXISTS and returns real chart data, but
 *   its shape is `{ countries, videos, artists }`: 40 ranked artists
 *   (`rank`, `trend`, `subscribers`, `browseId`) and 2 chart *video
 *   playlists* — there is NO songs list in it. So charts can honestly
 *   power the trending-artists section (ranks taken verbatim from the
 *   payload, never invented) but NOT a trending-songs section.
 * - `GET /browsing/explore` — EXISTS and returns `trending: { playlist,
 *   items }` (20 songs with `videoId` at probe time) plus
 *   `new_releases` (24 albums/singles with `browseId` + `artists`).
 *   The trending-songs section therefore comes from explore, and the
 *   UI labels it "Trending on YouTube Music" — NOT "Charts" — because
 *   it is not a charts endpoint.
 * - `GET /browsing/home` — exists too, but its rows are personalized
 *   quick picks, not a trending feed, so it is not used here.
 *
 * No ranking is hardcoded, seeded, or faked anywhere in this module:
 * song order is the explore payload's order, artist ranks are the
 * charts payload's `rank` field, and a section whose live source comes
 * back empty is omitted by the page rather than filled with filler.
 *
 * Partial failure is tolerated: if one of the two calls fails, the
 * sections from the other still render. Only a failure of BOTH calls
 * throws, so the page can show its error state.
 */
import { apiGet } from '../api';
import type { Track } from '../types/models';
import { normalizeList, primaryArtwork } from '../utils/track';

/** One ranked artist, straight from `/browsing/charts`. */
export interface TrendingArtist {
  name: string;
  /** Channel id (`UC…`) — routes to `/artist/:channelId`. */
  browseId: string | null;
  subscribers: string | null;
  /** Verbatim rank from the payload (`"1"`, `"2"`, …), null if absent. */
  rank: number | null;
  /** Payload trend: "up" | "down" | "neutral" | null. */
  trend: string | null;
  artwork: string | null;
}

/** One new release, straight from `/browsing/explore`. */
export interface NewRelease {
  title: string;
  artists: string;
  /** Album browse id (`MPRE…`) — routes to `/collection/album/:id`. */
  browseId: string | null;
  audioPlaylistId: string | null;
  artwork: string | null;
  /** Payload type: "Album" | "Single" | … */
  type: string | null;
  isExplicit: boolean;
}

/** Everything the Discover page renders for "Best right now". */
export interface DiscoverData {
  trendingSongs: Track[];
  trendingArtists: TrendingArtist[];
  newReleases: NewRelease[];
  /** e.g. "Global" — from `charts.countries.selected.text`. */
  chartCountry: string | null;
}

export const EMPTY_DISCOVER: DiscoverData = {
  trendingSongs: [],
  trendingArtists: [],
  newReleases: [],
  chartCountry: null,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function artistNamesOf(raw: Record<string, unknown>): string {
  const artists = raw.artists;
  if (typeof artists === 'string') return artists;
  if (Array.isArray(artists)) {
    return artists
      .map((entry) =>
        typeof entry === 'string'
          ? entry
          : entry && typeof entry === 'object'
            ? asString((entry as Record<string, unknown>).name)
            : null,
      )
      .filter((name): name is string => Boolean(name))
      .join(', ');
  }
  return asString(raw.artist) ?? '';
}

/** Map a raw `/browsing/explore` payload to songs + releases. */
export function mapExplorePayload(payload: unknown): {
  trendingSongs: Track[];
  newReleases: NewRelease[];
} {
  const record = asRecord(payload);
  if (!record) return { trendingSongs: [], newReleases: [] };

  const trending = asRecord(record.trending);
  const trendingItems = trending
    ? Array.isArray(trending.items)
      ? trending.items
      : []
    : Array.isArray(record.trending)
      ? record.trending
      : [];
  const trendingSongs = normalizeList(trendingItems);

  const releasesRaw = Array.isArray(record.new_releases) ? record.new_releases : [];
  const newReleases: NewRelease[] = [];
  for (const item of releasesRaw) {
    const release = asRecord(item);
    if (!release || !asString(release.title)) continue;
    newReleases.push({
      title: asString(release.title) as string,
      artists: artistNamesOf(release),
      browseId: asString(release.browseId),
      audioPlaylistId: asString(release.audioPlaylistId),
      artwork: primaryArtwork(release),
      type: asString(release.type),
      isExplicit: Boolean(release.isExplicit),
    });
  }
  return { trendingSongs, newReleases };
}

/** Map a raw `/browsing/charts` payload to ranked artists + country label. */
export function mapChartsPayload(payload: unknown): {
  trendingArtists: TrendingArtist[];
  chartCountry: string | null;
} {
  const record = asRecord(payload);
  if (!record) return { trendingArtists: [], chartCountry: null };

  const countries = asRecord(record.countries);
  const selected = countries ? asRecord(countries.selected) : null;
  const chartCountry = selected ? asString(selected.text) : null;

  const artistsRaw = Array.isArray(record.artists) ? record.artists : [];
  const trendingArtists: TrendingArtist[] = [];
  for (const item of artistsRaw) {
    const artist = asRecord(item);
    if (!artist || !asString(artist.title)) continue;
    const rankRaw = artist.rank;
    const rank =
      typeof rankRaw === 'number'
        ? rankRaw
        : typeof rankRaw === 'string' && /^\d+$/.test(rankRaw)
          ? Number(rankRaw)
          : null;
    trendingArtists.push({
      name: asString(artist.title) as string,
      browseId: asString(artist.browseId),
      subscribers: asString(artist.subscribers),
      rank,
      trend: asString(artist.trend),
      artwork: primaryArtwork(artist),
    });
  }
  // The payload arrives ranked, but sort defensively by its own rank so
  // display order is always the chart's order, never insertion luck.
  trendingArtists.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
  return { trendingArtists, chartCountry };
}

/** Merge the two live payloads; either side may be missing or empty. */
export function mergeDiscoverPayloads(explore: unknown, charts: unknown): DiscoverData {
  const { trendingSongs, newReleases } = mapExplorePayload(explore);
  const { trendingArtists, chartCountry } = mapChartsPayload(charts);
  return { trendingSongs, trendingArtists, newReleases, chartCountry };
}

/**
 * Fetch "Best right now" live. Throws only when BOTH endpoints fail;
 * a single failure still yields the other endpoint's sections.
 */
export async function fetchDiscover(signal?: AbortSignal): Promise<DiscoverData> {
  const [explore, charts] = await Promise.allSettled([
    apiGet('/browsing/explore', {}, signal),
    apiGet('/browsing/charts', {}, signal),
  ]);
  if (explore.status === 'rejected' && charts.status === 'rejected') {
    throw explore.reason instanceof Error
      ? explore.reason
      : new Error('Could not load Discover');
  }
  return mergeDiscoverPayloads(
    explore.status === 'fulfilled' ? explore.value : null,
    charts.status === 'fulfilled' ? charts.value : null,
  );
}
