import { IconButton, Tooltip } from './ui';

import { CheckCircleIcon, DownloadIcon } from './icons';
import { useFlag } from '../db/flags';
import { useDownloads } from '../hooks';
import { notify } from '../utils/downloadsStore';
import { formatBytes } from '../utils/format';
import type { Track, TrackMeta } from '../types/models';

interface DownloadButtonProps {
  track: Track;
  meta: TrackMeta | null;
  /** See `PlayerContext.waitForCache`. */
  waitForCache?: () => Promise<void>;
  size?: 'small' | 'medium';
}

/** "1m 5s" / "42s" — the ETA tail of the running label. */
function formatEta(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return '';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

/** Ring geometry copied from MUI's `CircularProgress` (SIZE 44, thickness 3.6). */
const RING_RADIUS = (44 - 3.6) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

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

  // While audio bytes are flowing, the running label carries the live
  // speed + ETA the pipeline reports; other phases have no byte rate.
  const speedPart =
    running && job?.step === 'Downloading audio' && job?.speedBps
      ? ` — ${formatBytes(job.speedBps)}/s${job.etaSeconds ? ` — ${formatEta(job.etaSeconds)} left` : ''}`
      : '';

  const label = running
    ? `${job?.step ?? 'Downloading'}${job?.progress ? ` — ${Math.round((job.progress || 0) * 100)}%` : ''}${speedPart} — tap to cancel`
    : done
      ? 'Saved to your library'
      : job?.status === 'error'
        ? (job.error ?? 'Download failed — tap to retry')
        : job?.status === 'skipped'
          ? (job.error
              ? `Skipped — ${job.error} — tap to retry`
              : 'Skipped — tap to retry')
          : 'Download for offline listening';

  const ringSize = size === 'small' ? 18 : 20;
  const ringValue = Math.round((job?.progress ?? 0) * 100);

  return (
    <Tooltip title={label} placement="top">
      <span>
        {/* MIGRATION: the kit has no `success` colour. `done` disables the
            button anyway, so the old disabled-grey cascade matched the kit's
            `disabled:` styling — `color` stays "default". */}
        <IconButton
          size={size}
          aria-label={label}
          // A running download is tappable: tapping cancels it (queued,
          // held or fetching). Only a saved song disables the button.
          disabled={done}
          onClick={() => {
            // Lazy-load the pipeline on the first tap — the module (audio
            // fetching, artwork, filesystem writes) stays out of the initial
            // bundle and is shared with the in-player menu.
            void import('../utils/downloads')
              .then((m) => {
                if (running) m.cancelDownload(track.videoId);
                else m.startDownload(track, meta, { waitForCache });
              })
              .catch(() =>
                notify(
                  'error',
                  running ? 'Could not cancel the download' : 'Could not start the download — try again',
                ),
              );
          }}
        >
          {running ? (
            /* MIGRATION: the kit `Spinner` only spins — the determinate ring is
                hand-drawn with MUI's exact geometry, accent colour and
                dashoffset transition (it used to be `CircularProgress
                variant="determinate"`). */
            <svg
              role="progressbar"
              aria-valuenow={ringValue}
              width={ringSize}
              height={ringSize}
              viewBox="22 22 44 44"
              className="block text-accent"
              style={{ transform: 'rotate(-90deg)' }}
            >
              <circle
                cx={44}
                cy={44}
                r={RING_RADIUS}
                fill="none"
                strokeWidth={3.6}
                stroke="currentColor"
                strokeDasharray={RING_CIRCUMFERENCE.toFixed(3)}
                strokeDashoffset={(((100 - ringValue) / 100) * RING_CIRCUMFERENCE).toFixed(3)}
                style={{ transition: 'stroke-dashoffset 300ms cubic-bezier(0.4, 0, 0.2, 1)' }}
              />
            </svg>
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
