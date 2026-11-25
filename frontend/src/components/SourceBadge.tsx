import { cn } from '../utils/cn';
import {
  PLAYBACK_SOURCE_LABELS,
  type PlaybackSourceId,
} from '../player/sourceLabel';

/**
 * The "playing from" badge: a small dot + the friendly name of the
 * source the current song is actually playing from
 * (`Downloaded` / `Carmen Server` / `Relay Server` / `Audius` /
 * `iTunes Preview`). Renders nothing when no song is playing, so it can
 * never show a stale server.
 *
 * It reads the id from the player context's `playbackSource` — the
 * single source of truth, set everywhere the audio source changes —
 * and never derives anything itself.
 */
export default function SourceBadge({
  source,
  className,
}: {
  /** Current playback source, or null when nothing is playing. */
  source: PlaybackSourceId | null;
  className?: string;
}) {
  if (!source) return null;
  const label = PLAYBACK_SOURCE_LABELS[source];
  return (
    <span
      data-testid="source-badge"
      aria-label={`Playing from ${label}`}
      title={`Playing from ${label}`}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-surface/70 px-1.5 py-px text-[10px] font-semibold leading-[1.5] text-muted',
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-accent" />
      {label}
    </span>
  );
}
