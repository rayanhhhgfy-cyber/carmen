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

import { Shimmer } from '../../components/ui';
import { EmptyHint, PageSummary } from './common';
import { UserIcon } from './glyphs';
import { GRID_CLASS, GroupCard, groupSongs, type CataloguePageProps } from './groupSongs';

export default function ArtistsSection({ songs, loading = false }: CataloguePageProps) {
  // No artist browse id on `Track` — artists jump to a search instead.
  const artists = useMemo(
    () => groupSongs(songs, (song) => song.artist, () => null, 'Unknown artist'),
    [songs],
  );

  if (loading && !songs.length) {
    return (
      <section>
        <PageSummary>Loading…</PageSummary>
        <div className={GRID_CLASS}>
          {[0, 1, 2, 3, 4].map((index) => (
            <Shimmer key={index} variant="rounded" height={170} />
          ))}
        </div>
      </section>
    );
  }

  if (!songs.length) {
    return (
      <section>
        <EmptyHint
          icon={<UserIcon sx={{ fontSize: 40 }} />}
          title="No artists yet"
          hint="Artists appear automatically as songs are downloaded."
        />
      </section>
    );
  }

  return (
    <section>
      <PageSummary>
        {`${artists.length} artist${artists.length === 1 ? '' : 's'} in your downloads`}
      </PageSummary>
      <div className={GRID_CLASS}>
        {artists.map((artist) => (
          <GroupCard
            key={artist.key}
            group={artist}
            shape="circle"
            to={`/search?query=${encodeURIComponent(artist.name)}`}
          />
        ))}
      </div>
    </section>
  );
}
