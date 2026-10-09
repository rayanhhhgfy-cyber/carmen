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

import { Shimmer } from '../../components/ui';
import { EmptyHint, PageSummary } from './common';
import { AlbumIcon } from './glyphs';
import { GRID_CLASS, GroupCard, groupSongs, type CataloguePageProps } from './groupSongs';

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
          icon={<AlbumIcon sx={{ fontSize: 40 }} />}
          title="No albums yet"
          hint="Albums appear automatically as songs are downloaded."
        />
      </section>
    );
  }

  return (
    <section>
      <PageSummary>
        {`${albums.length} album${albums.length === 1 ? '' : 's'} in your downloads`}
      </PageSummary>
      <div className={GRID_CLASS}>
        {albums.map((album) => (
          <GroupCard
            key={album.key}
            group={album}
            shape="square"
            to={album.browseId ? `/collection/album/${encodeURIComponent(album.browseId)}` : null}
          />
        ))}
      </div>
    </section>
  );
}
