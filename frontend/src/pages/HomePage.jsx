import { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Container,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import ShuffleIcon from '@mui/icons-material/Shuffle';
import HistoryIcon from '@mui/icons-material/History';
import { usePlayer } from '../player/PlayerContext';
import { RECENT_LIMIT, shuffleList, useLibrary } from '../utils/library';
import { normalizeTrack } from '../utils/track';
import MediaCard from '../components/MediaCard';
import { EmptyState } from '../components/TrackList';

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
 * from the related list of everything the user plays (reshuffled on every
 * visit).  The curated YouTube Music rows that used to sit underneath were
 * removed: the personal feed is all this page shows.
 */
export default function HomePage() {
  const player = usePlayer();
  const { recent, suggestions } = useLibrary();
  const [shuffleSeed, setShuffleSeed] = useState(0);

  const recentTracks = useMemo(
    () => recent.slice(0, RECENT_LIMIT).map((entry) => normalizeTrack(entry)).filter(Boolean),
    [recent],
  );

  // Suggestions are shuffled every time the page mounts or the pool changes.
  const suggestedTracks = useMemo(() => shuffleList(suggestions), [suggestions, shuffleSeed]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <Box sx={{ px: { xs: 2, md: 0 } }}>
          <Typography variant="h5">Listen now</Typography>
          <Typography variant="body2" color="text.secondary">
            {hasPersonalFeed
              ? 'Your recently played songs and picks built from what you listen to'
              : 'Play a song and this page fills up with your history and suggestions'}
          </Typography>
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
