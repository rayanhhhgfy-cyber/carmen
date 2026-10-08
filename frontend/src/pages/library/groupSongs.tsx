/**
 * Grouping + card grid shared by the Albums and Artists Library pages.
 *
 * Extracted from the old combined Albums & Artists section when the Library
 * became a tabbed hub (one page per tab): both pages group the same
 * catalogue of downloaded songs by a display name, so the map-reduce and
 * the card live here once. Groups keep the first artwork / browse id
 * encountered — later rows only fill gaps — and sort alphabetically.
 */
import { Box, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';

import type { DownloadedSong } from '../../types/models';
import { AlbumIcon, Artwork, UserIcon } from './glyphs';

/** One grouped card: display name, artwork, size and an optional target. */
export interface MediaGroup {
  key: string;
  name: string;
  artwork: string | null;
  count: number;
  /** Album browse id — `null` renders the card without a link. */
  browseId: string | null;
}

/** Props the two catalogue pages share (both fed by `LibraryPage`). */
export interface CataloguePageProps {
  /** The same catalogue the Songs page reads (loaded by `LibraryPage`). */
  songs: DownloadedSong[];
  loading?: boolean;
}

/**
 * Groups the songs by a display name, keeping the first artwork / browse id
 * encountered (later rows only fill gaps) and sorting alphabetically.
 */
export function groupSongs(
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

export function GroupCard({ group, shape, to }: GroupCardProps) {
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

/** Responsive card grid used by both catalogue pages. */
export const GRID_SX = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))',
  gap: 2,
} as const;
