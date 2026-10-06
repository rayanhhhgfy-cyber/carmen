import { Box, Chip, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { primaryArtwork } from '../utils/track';
import Artwork from './Artwork';
import { PlayArrowIcon } from './icons';

/**
 * Classify an arbitrary browse item (home rows, search results, related).
 * Returns the route / action to run when the card is tapped.
 */
export function resolveCard(item) {
  if (!item || typeof item !== 'object') return null;

  if (item.videoId && (item.artists || item.album || item.duration || item.length)) {
    return { kind: 'song', key: `song-${item.videoId}` };
  }
  if (item.playlistId) {
    return { kind: 'playlist', key: `playlist-${item.playlistId}` };
  }
  if (typeof item.browseId === 'string' && item.browseId.startsWith('MPRE')) {
    return { kind: 'album', key: `album-${item.browseId}` };
  }
  if (typeof item.browseId === 'string' && item.browseId.startsWith('UC')) {
    return { kind: 'artist', key: `artist-${item.browseId}` };
  }
  if (item.videoId) return { kind: 'song', key: `song-${item.videoId}` };
  if (item.browseId) return { kind: 'album', key: `album-${item.browseId}` };
  return null;
}

export default function MediaCard({ item, onPlaySong, songsContext = null, width = 156 }) {
  const navigate = useNavigate();
  const card = resolveCard(item);
  if (!card) return null;

  const isFluid = typeof width !== 'number';
  const boxWidth = isFluid ? width : `${width}px`;

  const artwork = primaryArtwork(item);
  const title = item.title || 'Untitled';
  const subtitle =
    item.artist ||
    (Array.isArray(item.artists)
      ? item.artists.map((artist) => artist?.name).filter(Boolean).join(', ')
      : item.author || item.description || item.type || '');

  const handleClick = () => {
    if (card.kind === 'song' && onPlaySong) {
      onPlaySong(item, songsContext);
    } else if (card.kind === 'album') {
      navigate(`/collection/album/${item.browseId}`);
    } else if (card.kind === 'playlist') {
      navigate(`/collection/playlist/${item.playlistId}`);
    } else if (card.kind === 'artist') {
      navigate(`/search?query=${encodeURIComponent(item.title || '')}`);
    }
  };

  const shape = card.kind === 'song' ? 'rounded' : 'circle';

  return (
    <Box
      component="button"
      type="button"
      onClick={handleClick}
      sx={{
        width: boxWidth,
        flex: isFluid ? 'auto' : `0 0 ${boxWidth}`,
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
      }}
    >
      <Box sx={{ position: 'relative', width: '100%', aspectRatio: '1 / 1' }}>
        <Artwork
          className="card-art"
          src={artwork}
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
        <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
          {subtitle || (card.kind === 'song' ? 'Song' : card.kind)}
        </Typography>
      </Box>
      {item.isExplicit && <Chip label="E" size="small" variant="outlined" sx={{ height: 18 }} />}
    </Box>
  );
}
