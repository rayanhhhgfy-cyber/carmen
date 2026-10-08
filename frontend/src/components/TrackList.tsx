import { Box, Divider, List, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import TrackRow from './TrackRow';
import type { Track, TrackMeta } from '../types/models';

/** Props for the vertical track list. */
export interface TrackListProps {
  /** Normalized tracks — everything inside shares one playback context. */
  tracks: Track[] | null | undefined;
  /** Enriched meta of the currently playing track, when it belongs to this list. */
  metaFor?: TrackMeta | null;
  /** Show the 1-based position instead of the cover art. */
  numbered?: boolean;
  showDividers?: boolean;
  dense?: boolean;
}

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
}: TrackListProps) {
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

/** Centered placeholder for an empty list. */
export function EmptyState({ title, hint }: { title: string; hint?: ReactNode }) {
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
