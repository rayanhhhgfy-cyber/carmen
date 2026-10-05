import { Box, Divider, List, Typography } from '@mui/material';
import TrackRow from './TrackRow';

/**
 * Vertical list of tracks.  `tracks` are already normalized, everything
 * inside shares the same playback context.
 */
export default function TrackList({
  tracks,
  metaFor = null,
  numbered = false,
  showDividers = true,
  dense = false,
}) {
  if (!tracks?.length) return null;

  return (
    <List dense={dense} disablePadding>
      {tracks.map((track, index) => (
        <Box key={`${track.videoId}-${index}`}>
          <TrackRow
            track={track}
            contextTracks={tracks}
            index={numbered ? index : null}
            meta={metaFor && metaFor.videoId === track.videoId ? metaFor : null}
          />
          {showDividers && index < tracks.length - 1 && (
            <Divider component="li" variant="inset" />
          )}
        </Box>
      ))}
    </List>
  );
}

export function EmptyState({ title, hint }) {
  return (
    <Box sx={{ py: 6, textAlign: 'center', px: 3 }}>
      <Typography variant="subtitle1" color="text.secondary">
        {title}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.disabled">
          {hint}
        </Typography>
      )}
    </Box>
  );
}
