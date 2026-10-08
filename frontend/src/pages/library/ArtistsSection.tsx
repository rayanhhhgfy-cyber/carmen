/**
 * Artists page — artists grouped from the downloaded songs (first song's
 * artwork + song count), split out of the old combined Albums & Artists
 * section.
 *
 * There is no artist route: `CollectionPage` only resolves `album` and
 * `playlist` kinds, and `Track` carries no artist browse id. Artists
 * therefore use the app-wide "go to artist" jump to a search for the name
 * (same as `MediaCard` / the player's ⋯ menu) — exactly what the old
 * combined section did for every artist.
 */
import { useMemo } from 'react';
import { Box, Skeleton } from '@mui/material';

import { EmptyHint, PageSummary } from './common';
import { UserIcon } from './glyphs';
import { GRID_SX, GroupCard, groupSongs, type CataloguePageProps } from './groupSongs';

export default function ArtistsSection({ songs, loading = false }: CataloguePageProps) {
  // No artist browse id on `Track` — artists jump to a search instead.
  const artists = useMemo(
    () => groupSongs(songs, (song) => song.artist, () => null, 'Unknown artist'),
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
          icon={<UserIcon sx={{ fontSize: 40 }} />}
          title="No artists yet"
          hint="Artists appear automatically as songs are downloaded."
        />
      </Box>
    );
  }

  return (
    <Box component="section">
      <PageSummary>
        {`${artists.length} artist${artists.length === 1 ? '' : 's'} in your downloads`}
      </PageSummary>
      <Box sx={GRID_SX}>
        {artists.map((artist) => (
          <GroupCard
            key={artist.key}
            group={artist}
            shape="circle"
            to={`/search?query=${encodeURIComponent(artist.name)}`}
          />
        ))}
      </Box>
    </Box>
  );
}
