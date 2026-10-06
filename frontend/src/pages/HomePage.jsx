import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Container,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import ShuffleIcon from '@mui/icons-material/Shuffle';
import { usePlayer } from '../player/PlayerContext';
import { RECENT_LIMIT, shuffleList, useLibrary } from '../utils/library';
import { normalizeTrack } from '../utils/track';
import MediaCard from '../components/MediaCard';
import { EmptyState } from '../components/TrackList';
import { HistoryIcon, RefreshIcon } from '../components/icons';

/** How far the list has to be pulled down on a phone to refresh. */
const PULL_DISTANCE = 90;

/** Horizontal, touch friendly row of artwork cards. */
function CardRow({ items, onPlaySong, songsContext }) {
  if (!items.length) return null;
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 2,
        overflowX: 'auto',
        px: { xs: 2, md: 0 },
        pb: 1,
        scrollSnapType: 'x proximity',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {items.map((item, index) => (
        <MediaCard
          key={`${item.videoId || item.browseId || item.playlistId || index}-${index}`}
          item={item}
          songsContext={songsContext}
          onPlaySong={onPlaySong}
        />
      ))}
    </Box>
  );
}

function SectionHeader({ title, subtitle, action }) {
  return (
    <Box
      sx={{
        px: { xs: 2, md: 0 },
        mb: 1.25,
        display: 'flex',
        alignItems: 'flex-end',
        gap: 1.5,
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="caption" color="text.secondary">
            {subtitle}
          </Typography>
        )}
      </Box>
      {action}
    </Box>
  );
}

/**
 * Responsive grid of artwork cards.
 *
 * Only the first page is rendered at once: every card goes through the
 * throttled artwork queue, so keeping the initial batch small (and letting
 * the browser lazy load what is on screen) is what keeps the home feed fast
 * and clear of CDN rate limits.
 */
function CardGrid({ items, onPlaySong, songsContext, pageSize = 12 }) {
  const [count, setCount] = useState(pageSize);
  const visible = items.slice(0, count);

  return (
    <>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(auto-fill, minmax(140px, 1fr))',
            md: 'repeat(auto-fill, minmax(158px, 1fr))',
          },
          gap: { xs: 1.75, md: 2.5 },
          px: { xs: 2, md: 0 },
        }}
      >
        {visible.map((item, index) => (
          <MediaCard
            key={`${item.videoId || item.browseId || index}-${index}`}
            item={item}
            width="100%"
            songsContext={songsContext}
            onPlaySong={onPlaySong}
          />
        ))}
      </Box>
      {count < items.length && (
        <Stack alignItems="center" sx={{ mt: 0.5 }}>
          <Button
            size="small"
            variant="outlined"
            onClick={() => setCount((value) => value + pageSize)}
          >
            Show {Math.min(pageSize, items.length - count)} more
          </Button>
        </Stack>
      )}
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
    let startY = null;

    const onTouchStart = (event) => {
      startY =
        window.scrollY <= 0 && event.touches.length === 1
          ? event.touches[0].clientY
          : null;
    };
    const onTouchMove = (event) => {
      if (startY === null) return;
      const distance = event.touches[0].clientY - startY;
      if (distance >= PULL_DISTANCE && window.scrollY <= 0) {
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
    () => feed.recent.slice(0, RECENT_LIMIT).map((entry) => normalizeTrack(entry)).filter(Boolean),
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

  const playFromSuggestions = (raw) => {
    const list = [raw, ...suggestionContext.filter((entry) => entry.videoId !== raw.videoId)];
    player.playTrack(raw, list);
  };

  return (
    <Container maxWidth="lg" sx={{ pt: { xs: 2, md: 3 }, px: { xs: 0, md: 3 } }}>
      <Stack spacing={3.5}>
        <Box
          sx={{
            px: { xs: 2, md: 0 },
            display: 'flex',
            alignItems: 'flex-start',
            gap: 1,
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h5">Listen now</Typography>
            <Typography variant="body2" color="text.secondary">
              {hasPersonalFeed
                ? 'Your recently played songs and picks built from what you listen to'
                : 'Play a song and this page fills up with your history and suggestions'}
            </Typography>
          </Box>
          {/* The feed only moves when the reader says so: pull it down on a
              phone, press this on a bigger screen. */}
          <Tooltip title="Refresh feed">
            <span>
              <IconButton
                aria-label="Refresh feed"
                onClick={refresh}
                disabled={refreshing}
                sx={{ mt: 0.5 }}
              >
                {refreshing ? (
                  <CircularProgress size={20} color="primary" />
                ) : (
                  <RefreshIcon fontSize="small" />
                )}
              </IconButton>
            </span>
          </Tooltip>
        </Box>

        {/* ── Recently played (max 10) ─────────────────────────────────── */}
        {recentTracks.length > 0 && (
          <Box>
            <SectionHeader
              title="Recently played"
              subtitle={`Last ${recentTracks.length} of ${RECENT_LIMIT} songs`}
              action={
                <Tooltip title="Play recent songs">
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
          </Box>
        )}

        {/* ── Suggested songs (shuffled, max 100) ──────────────────────── */}
        {suggestedTracks.length > 0 && (
          <Box>
            <SectionHeader
              title="Suggested for you"
              subtitle={`${suggestedTracks.length} song${
                suggestedTracks.length === 1 ? '' : 's'
              } gathered from songs you play`}
              action={
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Button
                    size="small"
                    startIcon={<ShuffleIcon fontSize="small" />}
                    onClick={() => player.playAll(suggestedTracks, 0)}
                  >
                    Shuffle all
                  </Button>
                  <Tooltip title="Reshuffle suggestions">
                    <IconButton
                      size="small"
                      aria-label="Reshuffle suggestions"
                      onClick={() => setShuffleSeed((value) => value + 1)}
                    >
                      <ShuffleIcon fontSize="small" color="disabled" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              }
            />
            <CardGrid
              items={suggestedTracks}
              songsContext={suggestionContext}
              onPlaySong={playFromSuggestions}
            />
          </Box>
        )}

        {!hasPersonalFeed && (
          <Box sx={{ px: 2 }}>
            <EmptyState
              title="Nothing here yet"
              hint="Songs you play show up here: the last 10 plays plus up to 100 suggestions from their related songs."
            />
          </Box>
        )}
      </Stack>
    </Container>
  );
}
