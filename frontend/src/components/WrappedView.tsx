/**
 * Wrapped — the all-time summary card for the stats page.
 *
 * Shows top track, top artist, total minutes, total plays and the current
 * streak. There is deliberately NO favourite genre here: Carmen's
 * normalized track shape carries no genre (see `utils/stats.ts`), so
 * Wrapped omits it rather than inventing one.
 */
import Artwork from './Artwork';
import { EmptyState } from './TrackList';
import type { WrappedSummary } from '../utils/stats';

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export default function WrappedView({ wrapped }: { wrapped: WrappedSummary | null }) {
  if (!wrapped) {
    return (
      <EmptyState
        title="Your Wrapped is waiting"
        hint="Listen past 30 seconds (or finish a track) and your year-in-music summary will appear here."
      />
    );
  }

  return (
    <section
      aria-label="Your Wrapped"
      className="overflow-hidden rounded-[42px] border border-line bg-surface p-4 md:p-6"
    >
      <p className="m-0 text-xs font-semibold uppercase tracking-wider text-muted">
        Your Wrapped · all time
      </p>
      <h3 className="m-0 mt-1 text-2xl font-extrabold leading-tight">
        {formatMinutes(wrapped.totalMinutes)} of music
      </h3>
      <p className="m-0 mt-1 text-sm text-muted">
        {wrapped.totalPlays} counted {wrapped.totalPlays === 1 ? 'play' : 'plays'}
        {wrapped.streak > 0
          ? ` · ${wrapped.streak}-day listening streak`
          : ' · no streak yet — play something today'}
      </p>

      <div className="mt-4 flex flex-col gap-3">
        {wrapped.topTrack && (
          <div className="flex items-center gap-3">
            <Artwork
              src={wrapped.topTrack.artwork}
              alt=""
              iconSize={24}
              style={{ width: 56, height: 56, borderRadius: 20, flexShrink: 0 }}
            />
            <div className="min-w-0 flex-1">
              <p className="m-0 text-xs text-muted">Top track</p>
              <p className="m-0 truncate text-base font-bold">{wrapped.topTrack.title}</p>
              <p className="m-0 truncate text-sm text-muted">
                {wrapped.topTrack.artist} · {wrapped.topTrack.plays}{' '}
                {wrapped.topTrack.plays === 1 ? 'play' : 'plays'}
              </p>
            </div>
          </div>
        )}

        {wrapped.topArtist && (
          <div className="min-w-0">
            <p className="m-0 text-xs text-muted">Top artist</p>
            <p className="m-0 truncate text-base font-bold">{wrapped.topArtist.artist}</p>
            <p className="m-0 text-sm text-muted">
              {wrapped.topArtist.plays} {wrapped.topArtist.plays === 1 ? 'play' : 'plays'} ·{' '}
              {wrapped.topArtist.minutes} min
            </p>
          </div>
        )}
      </div>

      <p className="m-0 mt-4 text-xs leading-[1.5] text-muted">
        A play counts when you listen past 30 seconds or finish the track.
        Genre isn&apos;t part of Carmen&apos;s track data, so Wrapped skips it.
      </p>
    </section>
  );
}
