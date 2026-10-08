import { Box, Chip, Stack, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import { useNavigate } from 'react-router-dom';

import type { MotionArtworkRef } from '../artwork/motion';
import { useFlags } from '../db/flags';
import { primaryArtwork } from '../utils/track';
import Artwork from './Artwork';
import { DownloadIcon, HeartFilledIcon, PlayArrowIcon } from './icons';
import MarqueeText from './MarqueeText';

/** Route / action to run when a browse item is tapped. */
export interface CardAction {
  kind: 'song' | 'playlist' | 'album' | 'artist';
  key: string;
}

/**
 * Classify an arbitrary browse item (home rows, search results, related).
 * Returns the route / action to run when the card is tapped.
 */
export function resolveCard(item: unknown): CardAction | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;

  if (
    record.videoId &&
    (record.artists || record.album || record.duration || record.length)
  ) {
    return { kind: 'song', key: `song-${String(record.videoId)}` };
  }
  if (record.playlistId) {
    return { kind: 'playlist', key: `playlist-${String(record.playlistId)}` };
  }
  if (typeof record.browseId === 'string' && record.browseId.startsWith('MPRE')) {
    return { kind: 'album', key: `album-${record.browseId}` };
  }
  if (typeof record.browseId === 'string' && record.browseId.startsWith('UC')) {
    return { kind: 'artist', key: `artist-${record.browseId}` };
  }
  if (record.videoId) return { kind: 'song', key: `song-${String(record.videoId)}` };
  if (record.browseId) return { kind: 'album', key: `album-${String(record.browseId)}` };
  return null;
}

/** Callback invoked when a song card is tapped: the raw payload plus an optional play context. */
export type MediaCardPlaySong = (
  item: Record<string, unknown>,
  context: unknown[] | null
) => void;

/** Props for the card shelf/grid tile. Payloads stay `unknown`; narrowing happens here. */
export interface MediaCardProps {
  item: unknown;
  onPlaySong?: MediaCardPlaySong | null;
  /** Ordered list the played song belongs to (e.g. a shelf's songs). */
  songsContext?: unknown[] | null;
  width?: number | string;
}

export default function MediaCard({
  item,
  onPlaySong,
  songsContext = null,
  width = 156,
}: MediaCardProps) {
  const navigate = useNavigate();
  const card = resolveCard(item);
  // Badges on song tiles (home / search shelves): one store read per card,
  // live like everywhere else.
  const flags = useFlags();
  if (!card) return null;

  const record = (item ?? {}) as Record<string, unknown>;
  const videoId = typeof record.videoId === 'string' ? record.videoId : null;
  const isDownloaded = Boolean(videoId) && flags.downloaded.has(videoId as string);
  const isFavorite = Boolean(videoId) && flags.favorite.has(videoId as string);
  const isFluid = typeof width !== 'number';
  const boxWidth = isFluid ? width : `${width}px`;

  const artwork = primaryArtwork(item);
  const title =
    (typeof record.title === 'string' && record.title) || 'Untitled';

  // Animated cover identity: a song tile looks its own album up — and when
  // a flat search/queue record carries none (the common case), falls back
  // to its own `"Title - Artist"` identity via an iTunes *song* search. An
  // album tile uses its title. Artist and playlist tiles have no catalogue
  // album and stay static (an artist name is no album to match).
  const rawAlbum = record.albumName ?? record.album;
  const songAlbum =
    typeof rawAlbum === 'string'
      ? rawAlbum
      : rawAlbum && typeof rawAlbum === 'object' &&
          typeof (rawAlbum as { name?: unknown }).name === 'string'
        ? (rawAlbum as { name: string }).name
        : '';
  // Just the artist fields — the subtitle's author/description fallbacks
  // below are display-only noise that Apple would happily match on.
  const motionArtist =
    typeof record.artist === 'string' && record.artist
      ? record.artist
      : Array.isArray(record.artists)
        ? record.artists
            .map((artist) =>
              artist && typeof artist === 'object'
                ? (artist as Record<string, unknown>).name
                : undefined,
            )
            .filter((name): name is string => typeof name === 'string' && Boolean(name))
            .join(', ')
        : '';
  let motionRef: MotionArtworkRef | null = null;
  if (card.kind === 'song') {
    motionRef = { album: songAlbum, videoId, title, artist: motionArtist };
  } else if (card.kind === 'album') {
    motionRef = { album: title, artist: motionArtist };
  }

  // Subtitle: explicit artist, joined artist list, or a fallback chain.
  let subtitle = '';
  if (typeof record.artist === 'string' && record.artist) {
    subtitle = record.artist;
  } else if (Array.isArray(record.artists)) {
    subtitle = record.artists
      .map((artist) =>
        artist && typeof artist === 'object'
          ? (artist as Record<string, unknown>).name
          : undefined,
      )
      .filter((name): name is string => typeof name === 'string' && Boolean(name))
      .join(', ');
  } else if (typeof record.author === 'string' && record.author) {
    subtitle = record.author;
  } else if (typeof record.description === 'string' && record.description) {
    subtitle = record.description;
  } else if (typeof record.type === 'string' && record.type) {
    subtitle = record.type;
  }

  const handleClick = () => {
    if (card.kind === 'song' && onPlaySong) {
      onPlaySong(record, songsContext);
    } else if (card.kind === 'album') {
      navigate(`/collection/album/${String(record.browseId)}`);
    } else if (card.kind === 'playlist') {
      navigate(`/collection/playlist/${String(record.playlistId)}`);
    } else if (card.kind === 'artist') {
      navigate(
        `/search?query=${encodeURIComponent(
          (typeof record.title === 'string' && record.title) || '',
        )}`,
      );
    }
  };

  const shape = card.kind === 'song' ? 'rounded' : 'circle';
  const buttonSx: SxProps<Theme> = {
    width: boxWidth as never,
    flex: isFluid ? 'auto' : `0 0 ${boxWidth}`,
    // Grid/flex children default to an automatic minimum of their
    // min-content width — a nowrap title would inflate the card over its
    // neighbours and defeat MarqueeText's overflow measurement.
    minWidth: 0,
    p: 0,
    m: 0,
    border: 'none',
    background: 'none',
    textAlign: 'left',
    cursor: 'pointer',
    scrollSnapAlign: 'start',
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    '&:hover .card-art': { transform: 'scale(1.04)' },
    '&:hover .card-play': { opacity: 1, transform: 'translateY(0)' },
  };

  return (
    <Box component="button" type="button" onClick={handleClick} sx={buttonSx}>
      <Box sx={{ position: 'relative', width: '100%', aspectRatio: '1 / 1' }}>
        <Artwork
          className="card-art"
          src={artwork}
          motion={motionRef}
          alt=""
          iconSize={44}
          sx={{
            position: 'absolute',
            inset: 0,
            borderRadius: shape === 'circle' ? '50%' : 2,
            transition: 'transform 220ms ease',
            boxShadow: 1,
          }}
        />
        {(isDownloaded || isFavorite) && (
          <Stack
            direction="row"
            spacing={0.5}
            sx={{
              position: 'absolute',
              top: 6,
              left: 6,
              px: 0.75,
              py: 0.25,
              borderRadius: 999,
              bgcolor: 'rgba(0,0,0,0.62)',
              color: '#fff',
              alignItems: 'center',
            }}
          >
            {isDownloaded && <DownloadIcon sx={{ fontSize: 13 }} />}
            {isFavorite && <HeartFilledIcon sx={{ fontSize: 13 }} />}
          </Stack>
        )}
        {card.kind === 'song' && (
          <Box
            className="card-play"
            sx={{
              position: 'absolute',
              right: 6,
              bottom: 6,
              width: 36,
              height: 36,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              opacity: 0,
              transform: 'translateY(6px)',
              transition: 'all 200ms ease',
              boxShadow: 3,
            }}
          >
            <PlayArrowIcon />
          </Box>
        )}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <MarqueeText text={title} variant="body2" sx={{ fontWeight: 600 }} />
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
          {subtitle || (card.kind === 'song' ? 'Song' : card.kind)}
        </Typography>
      </Box>
      {record.isExplicit === true && <Chip label="E" size="small" variant="outlined" sx={{ height: 18 }} />}
    </Box>
  );
}
