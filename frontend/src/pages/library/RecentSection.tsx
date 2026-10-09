/**
 * Recent page — the Library's Recent tab: a horizontally scrollable carousel
 * of the last ten downloads, newest first (`recentDownloads` orders by
 * `downloaded_at`). Tapping a card plays it in the context of the carousel.
 * The tab bar owns the title, so only the freshness line stays.
 */
import { useEffect, useState } from 'react';

import MarqueeText from '../../components/MarqueeText';
import { Shimmer } from '../../components/ui';
import { recentDownloads } from '../../db/repos/downloads';
import { usePlayer } from '../../player/PlayerContext';
import type { DownloadedSong } from '../../types/models';
import { EmptyHint, PageSummary } from './common';
import { Artwork, MusicNoteIcon } from './glyphs';

export default function RecentSection() {
  const player = usePlayer();
  const [songs, setSongs] = useState<DownloadedSong[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    recentDownloads(10)
      .then((rows) => {
        if (!cancelled) {
          setSongs(rows);
          setLoading(false);
        }
      })
      .catch((loadError) => {
        console.warn('[library] load recent downloads failed', loadError);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section>
      <PageSummary>Your last saves, newest first</PageSummary>

      {loading && !songs.length ? (
        <div className="flex gap-4 overflow-hidden">
          {[0, 1, 2, 3].map((index) => (
            <Shimmer key={index} variant="rounded" width={136} height={172} />
          ))}
        </div>
      ) : songs.length === 0 ? (
        <EmptyHint dense title="Nothing downloaded yet" hint="saved songs land here" />
      ) : (
        <div className="relative">
          <div className="flex gap-4 overflow-x-auto pb-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-hover [&::-webkit-scrollbar]:h-2 [scroll-snap-type:x_proximity]">
            {songs.map((song) => (
              <button
                key={song.videoId}
                type="button"
                onClick={() => player.playTrack(song, songs)}
                className={
                  // No automatic minimum: a long title must clip + scroll
                  // inside the tile, not widen it over its neighbours.
                  'm-0 flex w-[136px] min-w-0 cursor-pointer flex-col gap-[6px] snap-start border-0 bg-transparent p-0 text-left [flex:0_0_136px] hover:[&_.recent-art]:[transform:scale(1.04)]'
                }
              >
                <Artwork
                  className="recent-art"
                  src={song.artwork}
                  alt=""
                  icon={MusicNoteIcon}
                  iconSize={40}
                  sx={{
                    width: '100%',
                    aspectRatio: '1 / 1',
                    borderRadius: 2,
                    boxShadow: 1,
                    transition: 'transform 220ms ease',
                  }}
                />
                <div className="min-w-0">
                  <MarqueeText text={song.title} variant="body2" sx={{ fontWeight: 600 }} />
                  <span className="block truncate text-xs leading-[1.4] text-muted">
                    {song.artist}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {/* Right-edge fade in the page's own background colour. */}
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-2 right-0 top-0 w-14"
            style={{
              background: 'linear-gradient(to right, transparent, var(--app-bg))',
            }}
          />
        </div>
      )}
    </section>
  );
}
