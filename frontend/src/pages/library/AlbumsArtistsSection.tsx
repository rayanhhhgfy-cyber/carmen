/**
 * Albums & Artists section — derived entirely from the downloaded songs:
 * they are grouped by `albumName` and `artist` and rendered as compact cards.
 *
 * Album cards link to `#/collection/album/<browseId>` — the only `kind` (next
 * to `playlist`) that `CollectionPage` actually resolves; there is no artist
 * kind, so artist cards use the app-wide "go to artist" jump to a search for
 * the artist name instead (same as `MediaCard` / the player's ⋯ menu).
 */
import { useMemo } from 'react';
import { Box, Skeleton, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';

import type { DownloadedSong } from '../../types/models';
import { EmptyHint, SectionHeader } from './common';
import { AlbumIcon, Artwork, UserIcon } from './glyphs';

interface AlbumsArtistsSectionProps {
  /** The same catalogue the Songs section reads (loaded by `LibraryPage`). */
  songs: DownloadedSong[];
  loading?: boolean;
}

/** One grouped card: display name, artwork, size and an optional target. */
interface MediaGroup {
  key: string;
  name: string;
  artwork: string | null;
  count: number;
  /** Album browse id — `null` renders the card without a link. */
  browseId: string | null;
}

/**
 * Groups the songs by a display name, keeping the first artwork / browse id
 * encountered (later rows only fill gaps) and sorting alphabetically.
 */
function groupSongs(
  songs: DownloadedSong[],
  nameOf: (song: DownloadedSong) => string,
  idOf: (song: DownloadedSong) => string | null,
  fallbackName: string,
): MediaGroup[] {
  const groups = new Map<string, MediaGroup>();
  for (const song of songs) {
    const name = nameOf(song).trim() || fallbackName;
    const existing = groups.get(name);
    if (existing) {
      existing.count += 1;
      if (!existing.artwork) existing.artwork = song.artwork;
      if (!existing.browseId) existing.browseId = idOf(song);
      continue;
    }
    groups.set(name, {
      key: name,
      name,
      artwork: song.artwork,
      count: 1,
      browseId: idOf(song),
    });
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

interface GroupCardProps {
  group: MediaGroup;
  /** Artwork silhouette — discs are square, people round. */
  shape: 'square' | 'circle';
  /** Route to navigate to, or `null` for a non-interactive card. */
  to: string | null;
}

function GroupCard({ group, shape, to }: GroupCardProps) {
  const navigate = useNavigate();

  return (
    <Box
      component="button"
      type="button"
      disabled={!to}
      onClick={() => {
        if (to) navigate(to);
      }}
      sx={{
        width: '100%',
        p: 0,
        m: 0,
        border: 0,
        background: 'none',
        textAlign: 'left',
        cursor: to ? 'pointer' : 'default',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
        '&:hover .group-art': to ? { transform: 'scale(1.04)' } : undefined,
      }}
    >
      <Artwork
        className="group-art"
        src={group.artwork}
        alt=""
        icon={shape === 'circle' ? UserIcon : AlbumIcon}
        iconSize={40}
        sx={{
          width: '100%',
          aspectRatio: '1 / 1',
          borderRadius: shape === 'circle' ? '50%' : 2,
          boxShadow: 1,
          transition: 'transform 220ms ease',
        }}
      />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
          {group.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {group.count} song{group.count === 1 ? '' : 's'}
        </Typography>
      </Box>
    </Box>
  );
}

const GRID_SX = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))',
  gap: 2,
} as const;

export default function AlbumsArtistsSection({ songs, loading = false }: AlbumsArtistsSectionProps) {
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

  // No artist browse id on `Track` — artists jump to a search instead.
  const artists = useMemo(
    () => groupSongs(songs, (song) => song.artist, () => null, 'Unknown artist'),
    [songs],
  );

  if (loading && !songs.length) {
    return (
      <Box component="section">
        <SectionHeader title="Albums & artists" icon={<AlbumIcon />} />
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
        <SectionHeader title="Albums & artists" icon={<AlbumIcon />} />
        <EmptyHint
          dense
          title="Nothing here yet"
          hint="albums and artists appear automatically as songs are downloaded"
        />
      </Box>
    );
  }

  return (
    <Box component="section">
      <SectionHeader
        title="Albums"
        caption={`${albums.length} album${albums.length === 1 ? '' : 's'} in your downloads`}
        icon={<AlbumIcon />}
      />
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

      <SectionHeader
        title="Artists"
        caption={`${artists.length} artist${artists.length === 1 ? '' : 's'} in your downloads`}
        icon={<UserIcon />}
      />
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
