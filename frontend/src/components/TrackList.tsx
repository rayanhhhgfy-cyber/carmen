import type { ReactNode } from 'react';

import { Divider, List } from './ui';
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
        <div key={`${track.videoId}-${index}`}>
          <TrackRow
            track={track}
            contextTracks={tracks}
            index={numbered ? index : null}
            meta={metaFor && metaFor.videoId === track.videoId ? metaFor : null}
          />
          {showDividers && index < tracks.length - 1 && (
            <Divider component="li" variant="inset" />
          )}
        </div>
      ))}
    </List>
  );
}

/** Centered placeholder for an empty list. */
export function EmptyState({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="px-4 py-12 text-center sm:px-6">
      <p className="m-0 text-base font-semibold text-muted">{title}</p>
      {hint && <span className="text-xs leading-[1.4] text-disabled">{hint}</span>}
    </div>
  );
}
