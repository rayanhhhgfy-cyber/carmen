import { CircularProgress, IconButton, Tooltip } from '@mui/material';
import { useDownloads } from '../hooks';
import { startDownload } from '../utils/downloads';
import { CheckCircleIcon, DownloadIcon } from './icons';

/**
 * Triggers the client side MP3 download (transcode + ID3 tagging).
 * Shows live progress while the browser works.
 */
export default function DownloadButton({ track, meta, size = 'medium', ...props }) {
  const { jobs } = useDownloads();
  const job = jobs[track?.videoId];
  const running = job?.status === 'running';
  const done = job?.status === 'done';

  if (!track?.videoId) return null;

  const label = running ? job.step : done ? 'Saved to your device' : 'Download as MP3';

  return (
    <Tooltip title={label}>
      <span>
        <IconButton
          size={size}
          aria-label={label}
          color={done ? 'success' : 'default'}
          disabled={running || done}
          onClick={(event) => {
            event.stopPropagation();
            startDownload(track, meta);
          }}
          {...props}
        >
          {running ? (
            <CircularProgress size={18} variant="determinate" value={Math.round((job.progress || 0) * 100)} />
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
