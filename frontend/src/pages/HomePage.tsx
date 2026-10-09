import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Container, IconButton, Spinner, Tooltip } from '../components/ui';
import type { ReactNode } from 'react';
import { usePlayer } from '../player/PlayerContext';
import { RECENT_LIMIT, shuffleList, useLibrary } from '../utils/library';
import { normalizeTrack } from '../utils/track';
import type { Track } from '../types/models';
import MediaCard from '../components/MediaCard';
import type { MediaCardPlaySong } from '../components/MediaCard';
import { EmptyState } from '../components/TrackList';
import { HistoryIcon, RefreshIcon, ShuffleIcon } from '../components/icons';

/** How far the list has to be pulled down on a phone to refresh. */
const PULL_DISTANCE = 90;

/**
 * "Is the page at the very top?" — the page scrolls inside
 * `<main id="app-main">` (Layout), not the window, so the gesture reads
 * that scroller; the window fallback keeps the guard honest if the
 * layout ever hands scrolling back to the document.
 */
function atScrollerTop(): boolean {
  const scroller = document.getElementById('app-main');
  return (scroller ? scroller.scrollTop : window.scrollY) <= 0;
}

/** Props shared by the shelf row and the responsive grid. */
interface FeedCardsProps {
  items: Track[];
  onPlaySong?: MediaCardPlaySong | null;
  songsContext?: unknown[] | null;
}

/** Horizontal, touch friendly row of artwork cards. */
function CardRow({ items, onPlaySong, songsContext }: FeedCardsProps) {
  if (!items.length) return null;
  return (
    <div className="flex gap-4 overflow-x-auto px-4 pb-2 [-webkit-overflow-scrolling:touch] [scroll-snap-type:x_proximity] md:px-0">
      {items.map((item, index) => (
        <MediaCard
          key={`${item.videoId || item.playlistId || index}-${index}`}
          item={item}
          songsContext={songsContext}
          onPlaySong={onPlaySong}
        />
      ))}
    </div>
  );
}

/** Header row of a feed section: title, subtitle and an optional action. */
function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-[10px] flex items-end gap-3 px-4 md:px-0">
      <div className="min-w-0 flex-1">
        <p className="m-0 text-base font-bold">{title}</p>
        {subtitle && <span className="text-xs leading-[1.4] text-muted">{subtitle}</span>}
      </div>
      {action}
    </div>
  );
}

/**
 * Responsive grid of artwork cards.
 *
 * Pages load **adaptively**: one page is rendered and, while a sentinel
 * just under the grid is still near the viewport, the next page is added —
 * 600px before the reader reaches the end, with no button to press.  A
 * first page that does not even fill the screen tops itself up until it
 * does, and it stops at the last card.
 *
 * Cards stay cheap because every one of them goes through the throttled
 * artwork queue and the browser lazy loads what is on screen, so the grid
 * only ever holds what has been asked for so far.
 */
function CardGrid({ items, onPlaySong, songsContext, pageSize = 12 }: FeedCardsProps & { pageSize?: number }) {
  const [count, setCount] = useState(pageSize);
  const visible = items.slice(0, count);
  const hasMore = count < items.length;
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasMore) return undefined;
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setCount((value) => Math.min(value + pageSize, items.length));
        }
      },
      // pull the trigger early, so the next page is painted before it is
      // reached and scrolling never catches up with the loader
      { rootMargin: '600px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
    // rebuilt on every growth on purpose: a sentinel that never left the
    // viewport fires no new entry, and a fresh observer reports its state
    // straight away — that is what fills a screen that is still too short
  }, [hasMore, count, pageSize, items.length]);

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3.5 px-4 md:grid-cols-[repeat(auto-fill,minmax(158px,1fr))] md:gap-5 md:px-0">
        {visible.map((item, index) => (
          <MediaCard
            key={`${item.videoId || index}-${index}`}
            item={item}
            width="100%"
            songsContext={songsContext}
            onPlaySong={onPlaySong}
          />
        ))}
      </div>
      {hasMore && <div ref={sentinelRef} aria-hidden className="h-[1px]" />}
    </>
  );
}

/**
 * Home page.
 *
 * Top of the page is the personal feed, entirely cached on the client:
 * the 10 most recently played songs and up to 100 suggested songs harvested
 * from the related list of everything the user plays (shuffled on every
 * visit).  The curated YouTube Music rows that used to sit underneath were
 * removed: the personal feed is all this page shows.
 *
 * The feed is shown as a **snapshot**: starting a song writes to the library
 * in the background, but the cards never reshuffle under the reader.  The
 * page picks the new state up only when the reader asks for it — pulling the
 * list down on a phone, or the refresh button.
 */
export default function HomePage() {
  const player = usePlayer();
  const library = useLibrary();
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // The visible feed.  Taken from the library on mount and on every refresh.
  const [feed, setFeed] = useState(() => ({
    recent: library.recent,
    suggestions: library.suggestions,
  }));

  const refresh = useCallback(() => {
    setFeed({ recent: [...library.recent], suggestions: [...library.suggestions] });
    setShuffleSeed((value) => value + 1);
    setRefreshing(true);
  }, [library]);

  // always call the latest refresh from the gesture listener
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!refreshing) return undefined;
    const timer = window.setTimeout(() => setRefreshing(false), 500);
    return () => window.clearTimeout(timer);
  }, [refreshing]);

  // Pull to refresh: drag the page down while it is already at the top.
  useEffect(() => {
    let startY: number | null = null;

    const onTouchStart = (event: TouchEvent) => {
      startY =
        atScrollerTop() && event.touches.length === 1
          ? event.touches[0].clientY
          : null;
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

  const recentTracks = useMemo(
    () =>
      feed.recent
        .slice(0, RECENT_LIMIT)
        .map((entry) => normalizeTrack(entry))
        .filter((entry): entry is Track => entry !== null),
    [feed.recent],
  );

  // Suggestions are shuffled on mount and again on every refresh, never
  // because a song started playing.
  const suggestedTracks = useMemo(() => shuffleList(feed.suggestions), [feed, shuffleSeed]); // eslint-disable-line react-hooks/exhaustive-deps

  const suggestionContext = useMemo(
    () => [...recentTracks, ...suggestedTracks],
    [recentTracks, suggestedTracks],
  );

  const hasPersonalFeed = recentTracks.length > 0 || suggestedTracks.length > 0;

  const playFromSuggestions = (raw: Record<string, unknown>) => {
    const videoId = typeof raw.videoId === 'string' ? raw.videoId : null;
    const list = [raw, ...suggestionContext.filter((entry) => entry.videoId !== videoId)];
    player.playTrack(raw, list);
  };

  return (
    <Container maxWidth="lg" className="!px-0 pt-4 md:!px-6 md:pt-6">
      <div className="flex flex-col gap-7">
        {/* The feed only moves when the reader says so: pull it down on a
            phone, press this on a bigger screen. */}
        <div className="flex justify-end px-4 md:px-0">
          {/* `placement="left"`: the button hugs the right edge, so a
              centred bubble would poke past the container and get clipped
              by `main`'s overflow-x lock */}
          <Tooltip title="Refresh feed" placement="left">
            <span>
              <IconButton
                aria-label="Refresh feed"
                onClick={refresh}
                disabled={refreshing}
              >
                {refreshing ? (
                  <Spinner size={20} />
                ) : (
                  <RefreshIcon fontSize="small" />
                )}
              </IconButton>
            </span>
          </Tooltip>
        </div>

        {/* ── Recently played (max 10) ─────────────────────────────────── */}
        {recentTracks.length > 0 && (
          <div>
            <SectionHeader
              title="Recently played"
              subtitle={`Last ${recentTracks.length} of ${RECENT_LIMIT} songs`}
              action={
                <Tooltip title="Play recent songs" placement="left">
                  <IconButton
                    size="small"
                    aria-label="Play recently played songs"
                    onClick={() => player.playAll(recentTracks, 0)}
                  >
                    <HistoryIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              }
            />
            <CardRow
              items={recentTracks}
              songsContext={recentTracks}
              onPlaySong={(raw, context) => player.playTrack(raw, context || recentTracks)}
            />
          </div>
        )}

        {/* ── Suggested songs (shuffled, max 100) ──────────────────────── */}
        {suggestedTracks.length > 0 && (
          <div>
            <SectionHeader
              title="Suggested for you"
              subtitle={`${suggestedTracks.length} song${
                suggestedTracks.length === 1 ? '' : 's'
              } gathered from songs you play`}
              action={
                <div className="flex flex-row items-center gap-1">
                  <Button
                    startIcon={<ShuffleIcon fontSize="small" />}
                    onClick={() => player.playAll(suggestedTracks, 0)}
                  >
                    Shuffle all
                  </Button>
                  <Tooltip title="Reshuffle suggestions" placement="left">
                    <IconButton
                      size="small"
                      aria-label="Reshuffle suggestions"
                      onClick={() => setShuffleSeed((value) => value + 1)}
                    >
                      <ShuffleIcon fontSize="small" color="disabled" />
                    </IconButton>
                  </Tooltip>
                </div>
              }
            />
            <CardGrid
              items={suggestedTracks}
              songsContext={suggestionContext}
              onPlaySong={playFromSuggestions}
            />
          </div>
        )}

        {!hasPersonalFeed && (
          <div className="px-4">
            <EmptyState
              title="Nothing here yet"
              hint="Songs you play show up here: the last 10 plays plus up to 100 suggestions from their related songs."
            />
          </div>
        )}
      </div>
    </Container>
  );
}
