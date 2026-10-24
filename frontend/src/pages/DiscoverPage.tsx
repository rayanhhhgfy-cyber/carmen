/**
 * Discover page — two parts, both honest about where the data came from:
 *
 * 1. Your Daily Mix — generated on the client from the user's OWN
 *    library + favorites (`services/dailyMix`), refreshed once a day
 *    (date-keyed cache) or on demand via "Refresh mix". Every section
 *    shows its reason ("From your favourites", "Because you liked X",
 *    "More like Y") — never random filler presented as taste.
 *
 * 2. Best right now — LIVE data only (`services/discover`):
 *    - "Trending on YouTube Music" — songs from `/browsing/explore`'s
 *      trending feed. Labelled as trending, NOT "Charts": the charts
 *      endpoint carries no songs (see `services/discover`).
 *    - "Trending artists" — ranked artists from `/browsing/charts`,
 *      ranks verbatim from the payload.
 *    - "New releases" — albums/singles from `/browsing/explore`.
 *    A section whose live source comes back empty is omitted, never
 *    faked. Refresh button + the same pull-to-refresh gesture Home
 *    uses (drag down at the top of the page on a phone).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button, Container, IconButton, Spinner, Tooltip } from '../components/ui';
import MediaCard from '../components/MediaCard';
import TrackList, { EmptyState } from '../components/TrackList';
import { PlayArrowIcon, RefreshIcon } from '../components/icons';
import { listFavorites } from '../db/repos/favorites';
import { listPlaylists, listPlaylistTracks } from '../db/repos/playlists';
import { usePlayer } from '../player/PlayerContext';
import {
  fetchRelatedTracks,
  getDailyMix,
  type DailyMix,
  type DailyMixInput,
} from '../services/dailyMix';
import { fetchDiscover, type DiscoverData } from '../services/discover';
import type { Track } from '../types/models';
import { useLibrary } from '../utils/library';

/** How far the list has to be pulled down on a phone to refresh. */
const PULL_DISTANCE = 90;

/** The page scrolls inside `<main id="app-main">` (Layout), not the window. */
function atScrollerTop(): boolean {
  const scroller = document.getElementById('app-main');
  return (scroller ? scroller.scrollTop : window.scrollY) <= 0;
}

function trendMark(trend: string | null): string {
  if (trend === 'up') return '▲';
  if (trend === 'down') return '▼';
  return '–';
}

export default function DiscoverPage() {
  const player = usePlayer();
  const navigate = useNavigate();
  const library = useLibrary();

  const [mix, setMix] = useState<DailyMix | null>(null);
  const [mixLoading, setMixLoading] = useState(true);
  const [data, setData] = useState<DiscoverData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [mixRefreshing, setMixRefreshing] = useState(false);

  // The library pool the mix was built from, so a refresh reuses it
  // without re-reading the whole library.
  const poolRef = useRef<DailyMixInput | null>(null);

  const loadMix = useCallback(
    async (force: boolean, signal: AbortSignal) => {
      try {
        const favorites = await listFavorites().catch(() => [] as Track[]);
        if (signal.aborted) return;
        const playlists = await listPlaylists().catch(() => []);
        const playlistTracks: Track[] = [];
        for (const playlist of playlists) {
          try {
            const songs = await listPlaylistTracks(playlist.id);
            playlistTracks.push(...songs);
          } catch {
            /* one unreadable playlist must not kill the mix */
          }
          if (signal.aborted) return;
        }
        const seen = new Set<string>();
        const pool: Track[] = [];
        for (const track of [...playlistTracks, ...library.recent, ...library.suggestions]) {
          if (track?.videoId && !seen.has(track.videoId)) {
            seen.add(track.videoId);
            pool.push(track);
          }
        }
        // "More like" seed: related tracks of the first favorite, from
        // the existing related-tracks endpoint. Best effort — a failure
        // just means no "More like" section, never a broken mix.
        let relatedBySeed: Record<string, Track[]> = {};
        const seed = favorites[0];
        if (seed?.videoId) {
          const related = await fetchRelatedTracks(seed.videoId, signal);
          if (related.length) relatedBySeed = { [seed.videoId]: related };
        }
        if (signal.aborted) return;
        const input: DailyMixInput = { favorites, library: pool, relatedBySeed };
        poolRef.current = input;
        setMix(getDailyMix(input, { force }));
      } catch {
        if (!signal.aborted) setMix(null);
      } finally {
        if (!signal.aborted) {
          setMixLoading(false);
          setMixRefreshing(false);
        }
      }
    },
    [library],
  );

  const loadDiscover = useCallback(async (signal: AbortSignal) => {
    setError(null);
    try {
      const fresh = await fetchDiscover(signal);
      if (!signal.aborted) setData(fresh);
    } catch (requestError) {
      if (!signal.aborted) {
        setError(requestError instanceof Error ? requestError.message : 'Could not load Discover');
      }
    } finally {
      if (!signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  const refreshAll = useCallback(() => {
    setRefreshing(true);
    const controller = new AbortController();
    void loadDiscover(controller.signal);
    if (poolRef.current) {
      // A pull/refresh re-reads live data and re-serves today's mix;
      // it does not force a new mix (that is the "Refresh mix" button).
      setMix(getDailyMix(poolRef.current, {}));
    }
    // The controller is intentionally not aborted: the refresh outlives
    // this handler, like Home's refresh.
    void controller;
  }, [loadDiscover]);

  const refreshRef = useRef(refreshAll);
  useEffect(() => {
    refreshRef.current = refreshAll;
  }, [refreshAll]);

  useEffect(() => {
    const controller = new AbortController();
    void loadDiscover(controller.signal);
    void loadMix(false, controller.signal);
    return () => controller.abort();
  }, [loadDiscover, loadMix]);

  // Pull to refresh — the same gesture Home uses.
  useEffect(() => {
    let startY: number | null = null;
    const onTouchStart = (event: TouchEvent) => {
      startY = atScrollerTop() && event.touches.length === 1 ? event.touches[0].clientY : null;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (startY === null) return;
      const distance = event.touches[0].clientY - startY;
      if (distance >= PULL_DISTANCE && atScrollerTop()) {
        startY = null;
        refreshRef.current();
      }
    };
    const onTouchEnd = () => {
      startY = null;
    };
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  const refreshMix = () => {
    if (!poolRef.current) return;
    setMixRefreshing(true);
    setMix(getDailyMix(poolRef.current, { force: true }));
    setMixRefreshing(false);
  };

  const hasBestRightNow =
    (data?.trendingSongs.length ?? 0) > 0 ||
    (data?.trendingArtists.length ?? 0) > 0 ||
    (data?.newReleases.length ?? 0) > 0;
  const hasAnything = (mix?.totalTracks ?? 0) > 0 || hasBestRightNow;

  return (
    <Container maxWidth="lg" className="!px-0 pt-4 md:!px-6 md:pt-6">
      <div className="flex flex-col gap-7">
        <div className="flex items-end justify-between px-4 md:px-0">
          <div className="min-w-0">
            <p className="m-0 text-xl font-bold">Discover</p>
            <span className="text-xs leading-[1.4] text-muted">
              Your Daily Mix, plus the best right now on YouTube Music.
            </span>
          </div>
          <Tooltip title="Refresh Discover" placement="left">
            <span>
              <IconButton aria-label="Refresh Discover" onClick={refreshAll} disabled={refreshing}>
                {refreshing ? <Spinner size={20} /> : <RefreshIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
        </div>

        {/* ── Your Daily Mix ─────────────────────────────────────────── */}
        <div>
          <div className="mb-[10px] flex items-end gap-3 px-4 md:px-0">
            <div className="min-w-0 flex-1">
              <p className="m-0 text-base font-bold">Your Daily Mix</p>
              <span className="text-xs leading-[1.4] text-muted">
                {mix ? `Made for ${mix.date} from your own library and favourites` : 'Made from your own library and favourites'}
              </span>
            </div>
            <Button
              onClick={refreshMix}
              disabled={mixRefreshing || !poolRef.current}
              className="shrink-0"
            >
              {mixRefreshing ? 'Refreshing…' : 'Refresh mix'}
            </Button>
          </div>
          {mixLoading ? (
            <div className="flex justify-center px-4 py-8">
              <Spinner size={32} />
            </div>
          ) : mix && mix.sections.length > 0 ? (
            <div className="flex flex-col gap-6">
              {mix.sections.map((section) => (
                <div key={section.id}>
                  <div className="mb-[10px] flex items-end gap-3 px-4 md:px-0">
                    <div className="min-w-0 flex-1">
                      <p className="m-0 text-base font-bold">{section.title}</p>
                      <span className="text-xs leading-[1.4] text-muted">{section.reason}</span>
                    </div>
                    <Tooltip title={`Play ${section.title}`} placement="left">
                      <IconButton
                        size="small"
                        aria-label={`Play ${section.title}`}
                        onClick={() => player.playAll(section.tracks, 0)}
                      >
                        <PlayArrowIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </div>
                  <TrackList tracks={section.tracks} showDividers={false} />
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4">
              <EmptyState
                title="Your Daily Mix is empty"
                hint="Favourite songs or add some to your library, then refresh — the mix is built only from music you already own here."
              />
            </div>
          )}
        </div>

        {/* ── Best right now (live) ──────────────────────────────────── */}
        <div>
          <div className="mb-[10px] px-4 md:px-0">
            <p className="m-0 text-base font-bold">Best right now</p>
            <span className="text-xs leading-[1.4] text-muted">
              Live from YouTube Music — nothing here is ranked by Carmen.
            </span>
          </div>
          {loading ? (
            <div className="flex justify-center px-4 py-8">
              <Spinner size={32} />
            </div>
          ) : error && !hasBestRightNow ? (
            <div className="px-4">
              <EmptyState
                title="Could not load Best right now"
                hint={`${error} — your Daily Mix above is unaffected.`}
              />
              <div className="mt-2 flex justify-center">
                <Button onClick={refreshAll}>Try again</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-7">
              {data && data.trendingSongs.length > 0 && (
                <div>
                  <div className="mb-[10px] flex items-end gap-3 px-4 md:px-0">
                    <div className="min-w-0 flex-1">
                      <p className="m-0 text-base font-bold">Trending on YouTube Music</p>
                      <span className="text-xs leading-[1.4] text-muted">
                        What people are listening to right now
                      </span>
                    </div>
                    <Tooltip title="Play trending songs" placement="left">
                      <IconButton
                        size="small"
                        aria-label="Play trending songs"
                        onClick={() => player.playAll(data.trendingSongs, 0)}
                      >
                        <PlayArrowIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </div>
                  <TrackList tracks={data.trendingSongs} showDividers={false} />
                </div>
              )}

              {data && data.trendingArtists.length > 0 && (
                <div>
                  <div className="mb-[10px] px-4 md:px-0">
                    <p className="m-0 text-base font-bold">Trending artists</p>
                    <span className="text-xs leading-[1.4] text-muted">
                      Ranked by the YouTube Music charts
                      {data.chartCountry ? ` (${data.chartCountry})` : ''}
                    </span>
                  </div>
                  <div className="flex flex-col px-4 md:px-0">
                    {data.trendingArtists.slice(0, 20).map((artist) => (
                      <button
                        key={artist.browseId ?? artist.name}
                        type="button"
                        className="flex min-h-[44px] w-full items-center gap-3 border-0 bg-transparent px-0 py-2 text-left"
                        onClick={() =>
                          artist.browseId && navigate(`/artist/${artist.browseId}`)
                        }
                        disabled={!artist.browseId}
                      >
                        <span className="w-6 shrink-0 text-center text-sm font-bold text-muted">
                          {artist.rank ?? '–'}
                        </span>
                        {artist.artwork && (
                          <img
                            src={artist.artwork}
                            alt=""
                            className="h-10 w-10 shrink-0 rounded-full object-cover"
                            loading="lazy"
                          />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{artist.name}</span>
                          {artist.subscribers && (
                            <span className="block text-xs text-muted">
                              {artist.subscribers} subscribers
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-xs text-muted" aria-label={`Trend: ${artist.trend ?? 'neutral'}`}>
                          {trendMark(artist.trend)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {data && data.newReleases.length > 0 && (
                <div>
                  <div className="mb-[10px] px-4 md:px-0">
                    <p className="m-0 text-base font-bold">New releases</p>
                    <span className="text-xs leading-[1.4] text-muted">
                      Fresh albums and singles on YouTube Music
                    </span>
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3.5 px-4 md:grid-cols-[repeat(auto-fill,minmax(158px,1fr))] md:gap-5 md:px-0">
                    {data.newReleases.map((release) => (
                      <MediaCard
                        key={release.browseId ?? release.title}
                        item={{
                          title: release.title,
                          artists: release.artists
                            ? release.artists.split(', ').map((name) => ({ name }))
                            : [],
                          browseId: release.browseId,
                          thumbnails: release.artwork ? [{ url: release.artwork }] : [],
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {!hasBestRightNow && !error && (
                <div className="px-4">
                  <EmptyState
                    title="Nothing trending right now"
                    hint="YouTube Music returned no trending songs, artists, or releases — try refreshing."
                  />
                </div>
              )}
              {error && hasBestRightNow && (
                <div className="px-4">
                  <EmptyState
                    title="Part of Best right now could not load"
                    hint="Showing the sections that did load — refresh to retry the rest."
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {!loading && !mixLoading && !hasAnything && !error && (
          <div className="px-4">
            <EmptyState
              title="Nothing to discover yet"
              hint="Play and favourite some music first, and check back for trending songs and releases."
            />
          </div>
        )}
      </div>
    </Container>
  );
}
