import { CircularProgress, IconButton, Tooltip } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import CheckIcon from '@mui/icons-material/CheckCircle';
import { useDownloads } from '../hooks';
import { startDownload } from '../utils/downloads';

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
            <CheckIcon fontSize={size} />
          ) : (
            <DownloadIcon fontSize={size} />
          )}
        </IconButton>
      </span>
    </Tooltip>
  );
}
