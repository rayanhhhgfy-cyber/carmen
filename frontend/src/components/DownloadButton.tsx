import { CircularProgress, IconButton, Tooltip } from '@mui/material';

import { CheckCircleIcon, DownloadIcon } from './icons';
import { useFlag } from '../db/flags';
import { useDownloads } from '../hooks';
import { startDownload } from '../utils/downloads';
import type { Track, TrackMeta } from '../types/models';

interface DownloadButtonProps {
  track: Track;
  meta: TrackMeta | null;
  /** See `PlayerContext.waitForCache`. */
  waitForCache?: () => Promise<void>;
  size?: 'small' | 'medium';
}

/**
 * Download / progress control for a song.
 *
 * Shows a determinate ring while the raw audio + cover + lyrics land in the
 * sandbox, a check once it is part of the offline library, and the plain
 * download glyph otherwise.
 */
export default function DownloadButton({
  track,
  meta,
  waitForCache,
  size = 'medium',
}: DownloadButtonProps) {
  const { jobs } = useDownloads();
  const job = jobs[track.videoId];
  const running = job?.status === 'running';
  // The persisted flag (not the in-session job) decides the saved state, so a
  // song stays "saved" across re-plays and app restarts.
  const downloaded = useFlag('downloaded', track.videoId);
  const done = downloaded || job?.status === 'done';

  const label = running
    ? `${job?.step ?? 'Downloading'}${job?.progress ? ` — ${Math.round((job.progress || 0) * 100)}%` : ''}`
    : done
      ? 'Saved to your library'
      : job?.status === 'error'
        ? (job.error ?? 'Download failed — tap to retry')
        : 'Download for offline listening';

  return (
    <Tooltip title={label} placement="top">
      <span>
        <IconButton
          size={size}
          aria-label={label}
          disabled={running || done}
          onClick={() => startDownload(track, meta, { waitForCache })}
          color={done ? 'success' : 'default'}
        >
          {running ? (
            <CircularProgress
              size={size === 'small' ? 18 : 20}
              variant="determinate"
              value={Math.round((job?.progress ?? 0) * 100)}
            />
          ) : done ? (
            <CheckCircleIcon fontSize={size} />
          ) : (
            <DownloadIcon fontSize={size} />
          )}
        </IconButton>
      </span>
    </Tooltip>
  );
}
