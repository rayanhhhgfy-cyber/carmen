/**
 * Library — the offline-first hub: Playlists, Songs (downloads), Albums &
 * Artists (derived from the downloads) and Recently Downloaded.
 *
 * Selecting a playlist swaps the whole content area for an in-page detail
 * view instead of a route (the route stays `/library`), so closing it
 * remounts every section and they reload their data on their own.
 */
import { useCallback, useEffect, useState } from 'react';
import { Box, Container, Stack, Typography } from '@mui/material';

import { listDownloads } from '../db/repos/downloads';
import type { DownloadedSong } from '../types/models';
import AlbumsArtistsSection from './library/AlbumsArtistsSection';
import PlaylistsSection from './library/PlaylistsSection';
import PlaylistDetailView from './library/PlaylistDetailView';
import RecentSection from './library/RecentSection';
import SongsSection from './library/SongsSection';
import { LibraryIcon } from './library/glyphs';

export default function LibraryPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [downloads, setDownloads] = useState<DownloadedSong[]>([]);
  const [downloadsLoading, setDownloadsLoading] = useState(true);

  // One read of the offline catalogue feeds the Albums & Artists grouping;
  // the Songs section runs its own sorted query and the detail view swaps
  // the content area (remounting everything behind it when it closes).
  useEffect(() => {
    let cancelled = false;
    setDownloadsLoading(true);
    listDownloads()
      .then((rows) => {
        if (!cancelled) {
          setDownloads(rows);
          setDownloadsLoading(false);
        }
      })
      .catch((loadError) => {
        console.warn('[library] load catalogue failed', loadError);
        if (!cancelled) setDownloadsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Stable identity: the detail view keys its load effect on this callback.
  const handleBack = useCallback(() => setSelectedId(null), []);

  return (
    <Container maxWidth="lg" sx={{ pt: { xs: 2, md: 3 }, pb: { xs: 4, md: 6 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <LibraryIcon color="primary" sx={{ fontSize: 34 }} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
            Library
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Playlists, downloads and collections on this device
          </Typography>
        </Box>
      </Box>

      {selectedId !== null ? (
        <PlaylistDetailView playlistId={selectedId} onBack={handleBack} />
      ) : (
        <Stack spacing={{ xs: 3.5, md: 4.5 }}>
          <PlaylistsSection onOpen={setSelectedId} />
          <SongsSection />
          <AlbumsArtistsSection songs={downloads} loading={downloadsLoading} />
          <RecentSection />
        </Stack>
      )}
    </Container>
  );
}
