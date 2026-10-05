import { Box, Button, Stack, Typography } from '@mui/material';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import ShuffleIcon from '@mui/icons-material/Shuffle';
import TrackList, { EmptyState } from './TrackList';
import { usePlayer } from '../player/PlayerContext';

/** Up-next list of the active queue. */
export default function QueueTab() {
  const player = usePlayer();

  return (
    <Box sx={{ height: '100%', overflowY: 'auto', px: 1, py: 1 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1, mb: 1 }}>
        <Typography variant="subtitle2" color="text.secondary">
          {player.queue.length
            ? `${player.queue.length} track${player.queue.length === 1 ? '' : 's'} up next`
            : 'Up next'}
        </Typography>
        <Stack direction="row" spacing={0.5}>
          <Button
            size="small"
            startIcon={<ShuffleIcon fontSize="small" />}
            onClick={player.toggleShuffle}
            color={player.shuffle ? 'primary' : 'inherit'}
          >
            Shuffle
          </Button>
          <Button
            size="small"
            startIcon={<DeleteSweepIcon fontSize="small" />}
            onClick={player.clearQueue}
            disabled={!player.queue.length}
          >
            Clear
          </Button>
        </Stack>
      </Stack>

      {player.queue.length ? (
        <TrackList tracks={player.queue} showDividers={false} />
      ) : (
        <EmptyState
          title="Your queue is empty"
          hint="Add songs from any list, or keep listening — related songs play automatically."
        />
      )}
    </Box>
  );
}
