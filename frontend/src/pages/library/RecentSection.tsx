/**
 * Recent page — the Library's Recent tab: a horizontally scrollable carousel
 * of the last ten downloads, newest first (`recentDownloads` orders by
 * `downloaded_at`). Tapping a card plays it in the context of the carousel.
 * The tab bar owns the title, so only the freshness line stays.
 */
import { useEffect, useState } from 'react';
import { Box, Skeleton, Typography, useTheme } from '@mui/material';

import { recentDownloads } from '../../db/repos/downloads';
import { usePlayer } from '../../player/PlayerContext';
import type { DownloadedSong } from '../../types/models';
import { EmptyHint, PageSummary } from './common';
import { Artwork, MusicNoteIcon } from './glyphs';

export default function RecentSection() {
  const player = usePlayer();
  const theme = useTheme();
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
    <Box component="section">
      <PageSummary>Your last saves, newest first</PageSummary>

      {loading && !songs.length ? (
        <Box sx={{ display: 'flex', gap: 2, overflow: 'hidden' }}>
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} variant="rounded" width={136} height={172} />
          ))}
        </Box>
      ) : songs.length === 0 ? (
        <EmptyHint dense title="Nothing downloaded yet" hint="saved songs land here" />
      ) : (
        <Box sx={{ position: 'relative' }}>
          <Box
            sx={{
              display: 'flex',
              gap: 2,
              overflowX: 'auto',
              pb: 1,
              scrollSnapType: 'x proximity',
              '&::-webkit-scrollbar': { height: 8 },
              '&::-webkit-scrollbar-thumb': { bgcolor: 'action.hover', borderRadius: 4 },
            }}
          >
            {songs.map((song) => (
              <Box
                key={song.videoId}
                component="button"
                type="button"
                onClick={() => player.playTrack(song, songs)}
                sx={{
                  width: 136,
                  flex: '0 0 136px',
                  p: 0,
                  m: 0,
                  border: 0,
                  background: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  scrollSnapAlign: 'start',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.75,
                  '&:hover .recent-art': { transform: 'scale(1.04)' },
                }}
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
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                    {song.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                    {song.artist}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>

          {/* Right-edge fade in the page's own background colour. */}
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 8,
              width: 56,
              pointerEvents: 'none',
              background: `linear-gradient(to right, transparent, ${theme.palette.background.default})`,
            }}
          />
        </Box>
      )}
    </Box>
  );
}
