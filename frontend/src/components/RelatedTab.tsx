import { Box, Skeleton, Stack, Typography } from '@mui/material';
import TrackList, { EmptyState } from './TrackList';
import { usePlayer } from '../player/PlayerContext';

/**
 * Contextually related songs of the active track.  These are also used for
 * continuous auto-play when the queue runs out.
 */
export default function RelatedTab() {
  const player = usePlayer();
  const { related, relatedFor, current } = player;
  const loading = Boolean(current && relatedFor !== current.videoId);

  if (loading) {
    return (
      <Box sx={{ px: 2, py: 1 }}>
        {[0, 1, 2, 3, 4].map((row) => (
          <Stack key={row} direction="row" spacing={2} alignItems="center" sx={{ py: 1 }}>
            <Skeleton variant="rounded" width={44} height={44} />
            <Box sx={{ flex: 1 }}>
              <Skeleton variant="text" width="70%" />
              <Skeleton variant="text" width="40%" />
            </Box>
          </Stack>
        ))}
      </Box>
    );
  }

  if (!related.length) {
    return <EmptyState title="No related songs found" hint="Try another track." />;
  }

  return (
    <Box sx={{ height: '100%', overflowY: 'auto', px: 1, py: 1 }}>
      <Typography variant="subtitle2" color="text.secondary" sx={{ px: 1, mb: 0.5 }}>
        More like this — plays automatically when the queue ends
      </Typography>
      <TrackList tracks={related} showDividers={false} />
    </Box>
  );
}
