import { useEffect, useState } from 'react';
import { Box, Container, Skeleton, Stack, Typography } from '@mui/material';
import { apiGet } from '../api';
import { usePlayer } from '../player/PlayerContext';
import { normalizeTrack } from '../utils/track';
import MediaCard from '../components/MediaCard';
import { EmptyState } from '../components/TrackList';

function RowSkeleton() {
  return (
    <Box sx={{ display: 'flex', gap: 2, overflow: 'hidden' }}>
      {[0, 1, 2, 3, 4].map((card) => (
        <Box key={card} sx={{ width: 156, flex: '0 0 156px' }}>
          <Skeleton variant="rounded" height={156} />
          <Skeleton variant="text" width="80%" />
          <Skeleton variant="text" width="55%" />
        </Box>
      ))}
    </Box>
  );
}

/** Home page: curated rows coming from /browsing/home. */
export default function HomePage() {
  const player = usePlayer();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiGet('/browsing/home', { limit: 3 })
      .then((payload) => {
        if (cancelled) return;
        const list = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.categories)
            ? payload.categories
            : [];
        setRows(list.filter((row) => row?.contents?.length));
        setLoading(false);
      })
      .catch((requestError) => {
        if (cancelled) return;
        setError(requestError.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Container maxWidth="lg" sx={{ pt: { xs: 2, md: 3 }, px: { xs: 0, md: 3 } }}>
      <Stack spacing={3.5}>
        <Box sx={{ px: { xs: 2, md: 0 } }}>
          <Typography variant="h5">Listen now</Typography>
          <Typography variant="body2" color="text.secondary">
            Pick up where you left off or discover something new
          </Typography>
        </Box>

        {loading && (
          <Stack spacing={3}>
            <RowSkeleton />
            <RowSkeleton />
          </Stack>
        )}

        {error && (
          <Box sx={{ px: 2 }}>
            <EmptyState title="Could not load the home page" hint={error} />
          </Box>
        )}

        {!loading &&
          rows.map((row) => {
            const songs = row.contents
              .map((item) => normalizeTrack(item))
              .filter(Boolean);

            return (
              <Box key={row.title || Math.random()}>
                <Typography variant="subtitle1" sx={{ px: { xs: 2, md: 0 }, mb: 1.25 }}>
                  {row.title}
                </Typography>
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
                  {row.contents.map((item, index) => (
                    <MediaCard
                      key={`${item.videoId || item.browseId || item.playlistId || index}-${index}`}
                      item={item}
                      songsContext={songs}
                      onPlaySong={(raw) => player.playTrack(raw, songs)}
                    />
                  ))}
                </Box>
              </Box>
            );
          })}
      </Stack>
    </Container>
  );
}
