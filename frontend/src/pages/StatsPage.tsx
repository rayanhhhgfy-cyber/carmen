/**
 * Stats page — top tracks, top artists, minutes and streak for 7 days /
 * 30 days / all time, plus the all-time Wrapped card.
 *
 * Data comes from the persisted play history (`utils/stats.ts`, KV-backed
 * so it survives reloads); counting itself happens in the always-mounted
 * `PlayStatsWatcher` (see `hooks/usePlayStats.ts`), not here — this page
 * only reads. A play counts when playback passes 30 seconds or the track
 * completes; seeking, replay loops and restarts never double-count.
 */
import { useMemo, useState } from 'react';

import Artwork from '../components/Artwork';
import { EmptyState } from '../components/TrackList';
import WrappedView from '../components/WrappedView';
import { Button, Chip, Container, Tabs, Tab } from '../components/ui';
import { usePlayer } from '../player/PlayerContext';
import {
  buildWrapped,
  recordToTrack,
  summarizeStats,
  usePlayRecords,
  type StatsWindow,
} from '../utils/stats';

const WINDOWS: { id: StatsWindow; label: string }[] = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'all', label: 'All time' },
];

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export default function StatsPage() {
  // Subscribes to the store so new counted plays repaint this page live.
  const records = usePlayRecords();
  const player = usePlayer();
  const [window, setWindow] = useState<StatsWindow>('30d');

  const summary = useMemo(
    () => summarizeStats(records, window, Date.now()),
    [records, window],
  );
  const wrapped = useMemo(() => buildWrapped(records, Date.now()), [records]);

  return (
    <Container maxWidth="md" className="pt-3 md:pt-6">
      <div className="flex flex-col gap-4">
        <div>
          <h5 className="m-0 text-2xl font-bold">Stats</h5>
          <p className="m-0 text-sm leading-[1.43] text-muted">
            What you&apos;ve actually listened to — a play counts after 30 seconds or when a
            track finishes.
          </p>
        </div>

        <Tabs value={window} onChange={(value) => setWindow(value as StatsWindow)} variant="fullWidth">
          {WINDOWS.map(({ id, label }) => (
            <Tab key={id} value={id} label={label} />
          ))}
        </Tabs>

        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Plays', value: String(summary.plays) },
            { label: 'Minutes', value: formatMinutes(summary.minutes) },
            {
              label: 'Day streak',
              value: summary.streak > 0 ? `🔥 ${summary.streak}` : '—',
            },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="rounded-[28px] border border-line bg-surface px-3 py-3 text-center"
            >
              <p className="m-0 truncate text-lg font-extrabold leading-tight">{value}</p>
              <p className="m-0 text-xs text-muted">{label}</p>
            </div>
          ))}
        </div>

        <WrappedView wrapped={wrapped} />

        <section aria-label="Top tracks">
          <p className="m-0 mb-1 px-2 text-base font-semibold">Top tracks</p>
          {summary.tracks.length === 0 ? (
            <EmptyState
              title="No counted plays yet"
              hint="Play a song past 30 seconds and it will show up here."
            />
          ) : (
            <div className="overflow-hidden rounded-[42px] border border-line bg-surface">
              <ul className="m-0 list-none p-2">
                {summary.tracks.map((track, index) => (
                  <li key={track.videoId}>
                    <div className="flex items-center gap-3 rounded-[32px] px-2 py-2 hover:bg-hover">
                      <span className="w-5 shrink-0 text-center text-sm font-bold text-muted">
                        {index + 1}
                      </span>
                      <Artwork
                        src={track.artwork}
                        alt=""
                        iconSize={22}
                        style={{ width: 48, height: 48, borderRadius: 16, flexShrink: 0 }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="m-0 truncate text-sm font-semibold">{track.title}</p>
                        <p className="m-0 truncate text-xs text-muted">
                          {track.artist} · {track.plays} {track.plays === 1 ? 'play' : 'plays'} ·{' '}
                          {track.minutes} min
                        </p>
                      </div>
                      <Button
                        variant="text"
                        className="shrink-0 max-sm:min-h-11"
                        onClick={() => {
                          const record = records.find(
                            (entry) => entry.videoId === track.videoId,
                          );
                          if (record) player.playTrack(recordToTrack(record));
                        }}
                      >
                        Play
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section aria-label="Top artists">
          <p className="m-0 mb-1 px-2 text-base font-semibold">Top artists</p>
          {summary.artists.length === 0 ? (
            <EmptyState
              title="No artists yet"
              hint="Counted plays will rank your most-played artists here."
            />
          ) : (
            <div className="flex flex-wrap gap-2 px-1 pb-2">
              {summary.artists.map((artist) => (
                <Chip
                  key={artist.artist}
                  label={`${artist.artist} · ${artist.plays} ${artist.plays === 1 ? 'play' : 'plays'}`}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </Container>
  );
}
