/**
 * Albums page — the Library tab that lists the albums found in the
 * downloads, grouped from the catalogue `LibraryPage` loads.
 *
 * Album cards link to `#/collection/album/<browseId>` — the only detail
 * `kind` (next to `playlist`) that `CollectionPage` actually resolves; rows
 * without a browse id render as a disabled card (the old combined section
 * behaved the same way).
 */
import { useMemo } from 'react';
import { Box, Skeleton } from '@mui/material';

import { EmptyHint, PageSummary } from './common';
import { AlbumIcon } from './glyphs';
import { GRID_SX, GroupCard, groupSongs, type CataloguePageProps } from './groupSongs';

export default function AlbumsSection({ songs, loading = false }: CataloguePageProps) {
  const albums = useMemo(
    () =>
      groupSongs(
        songs,
        (song) => song.albumName,
        (song) => song.album?.id ?? null,
        'Unknown album',
      ),
    [songs],
  );

  if (loading && !songs.length) {
    return (
      <Box component="section">
        <PageSummary>Loading…</PageSummary>
        <Box sx={GRID_SX}>
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} variant="rounded" height={170} />
          ))}
        </Box>
      </Box>
    );
  }

  if (!songs.length) {
    return (
      <Box component="section">
        <EmptyHint
          icon={<AlbumIcon sx={{ fontSize: 40 }} />}
          title="No albums yet"
          hint="Albums appear automatically as songs are downloaded."
        />
      </Box>
    );
  }

  return (
    <Box component="section">
      <PageSummary>
        {`${albums.length} album${albums.length === 1 ? '' : 's'} in your downloads`}
      </PageSummary>
      <Box sx={GRID_SX}>
        {albums.map((album) => (
          <GroupCard
            key={album.key}
            group={album}
            shape="square"
            to={album.browseId ? `/collection/album/${encodeURIComponent(album.browseId)}` : null}
          />
        ))}
      </Box>
    </Box>
  );
}
