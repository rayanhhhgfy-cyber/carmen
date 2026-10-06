import { CircularProgress, IconButton, Tooltip } from '@mui/material';
import { useDownloads } from '../hooks';
import { usePlayer } from '../player/PlayerContext';
import { startDownload } from '../utils/downloads';
import { CheckCircleIcon, DownloadIcon } from './icons';

/**
 * Triggers the client side MP3 download (transcode + ID3 tagging).
 * Shows live progress while the browser works.
 *
 * For the song that is playing right now the job first waits for the
 * player's stream to finish writing the server side audio cache, so the
 * download reads that finished file instead of opening a second stream.
 */
export default function DownloadButton({ track, meta, size = 'medium', ...props }) {
  const { jobs } = useDownloads();
  const player = usePlayer();
  const job = jobs[track?.videoId];
  const running = job?.status === 'running';
  const done = job?.status === 'done';

  if (!track?.videoId) return null;

  const label = running ? job.step : done ? 'Saved to your device' : 'Download as MP3';

  const onClick = (event) => {
    event.stopPropagation();
    const playingHere = player.current?.videoId === track.videoId;
    startDownload(track, meta, {
      // resolves as soon as the server has the file (or waiting stopped
      // making sense); safe to skip when the song is not streaming
      waitForCache: playingHere ? () => player.waitForCache(track.videoId) : null,
    });
  };

  return (
    <Tooltip title={label}>
      <span>
        <IconButton
          size={size}
          aria-label={label}
          color={done ? 'success' : 'default'}
          disabled={running || done}
          onClick={onClick}
          {...props}
        >
          {running ? (
            job.progress > 0 ? (
              <CircularProgress
                size={18}
                variant="determinate"
                value={Math.round(job.progress * 100)}
              />
            ) : (
              // nothing to measure yet: the cache is filling, or a retry is pending
              <CircularProgress size={18} />
            )
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
