import { Box, IconButton, Typography, useTheme } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CircularProgress from '@mui/material/CircularProgress';
import { usePlayer } from '../player/PlayerContext';

/**
 * Compact player docked above the navigation bar. Tapping it opens the full
 * player sheet.
 */
export default function MiniPlayer({ bottomOffset }) {
  const player = usePlayer();
  const theme = useTheme();
  const track = player.current;

  if (!track) return null;

  const progress = player.duration ? (player.currentTime / player.duration) * 100 : 0;

  return (
    <Box
      onClick={() => player.setSheetOpen(true)}
      sx={{
        position: 'fixed',
        left: { xs: 8, sm: 12 },
        right: { xs: 8, sm: 12 },
        bottom: bottomOffset,
        zIndex: (t) => t.zIndex.appBar,
        bgcolor: 'rgba(0,0,0,0.82)',
        color: '#fff',
        borderRadius: 3,
        boxShadow: 8,
        overflow: 'hidden',
        cursor: 'pointer',
        backdropFilter: 'blur(14px)',
        border: '1px solid rgba(255,255,255,0.08)',
        '&:hover .mini-expand': { opacity: 1 },
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          height: '2px',
          width: `${progress}%`,
          bgcolor: 'primary.main',
          transition: 'width 250ms linear',
        }}
      />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.25, py: 1 }}>
        <Box sx={{ position: 'relative', width: 42, height: 42 }}>
          <Box
            component="img"
            src={track.artwork || undefined}
            alt=""
            sx={{ width: 42, height: 42, borderRadius: 1.5, objectFit: 'cover', bgcolor: 'rgba(255,255,255,0.1)' }}
          />
          {player.buffering && (
            <CircularProgress
              size={20}
              sx={{ position: 'absolute', inset: 0, margin: 'auto', color: 'primary.main' }}
            />
          )}
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 600, lineHeight: 1.2 }}>
            {track.title}
          </Typography>
          <Typography variant="caption" noWrap sx={{ display: 'block', color: 'rgba(255,255,255,0.65)' }}>
            {track.artist}
          </Typography>
        </Box>

        <IconButton
          size="small"
          aria-label={player.isPlaying ? 'Pause' : 'Play'}
          onClick={(event) => {
            event.stopPropagation();
            player.togglePlay();
          }}
          sx={{ color: 'inherit' }}
        >
          {player.isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
        </IconButton>
        <IconButton
          size="small"
          aria-label="Next track"
          onClick={(event) => {
            event.stopPropagation();
            player.next();
          }}
          sx={{ color: 'inherit' }}
        >
          <SkipNextIcon />
        </IconButton>
        <IconButton
          className="mini-expand"
          size="small"
          aria-label="Open player"
          onClick={(event) => {
            event.stopPropagation();
            player.setSheetOpen(true);
          }}
          sx={{ color: 'inherit', opacity: { xs: 1, md: 0.6 } }}
        >
          <ExpandLessIcon />
        </IconButton>
      </Box>
    </Box>
  );
}
