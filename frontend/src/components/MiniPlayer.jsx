import { Box, IconButton, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CircularProgress from '@mui/material/CircularProgress';
import { usePlayer } from '../player/PlayerContext';
import Artwork from './Artwork';

/**
 * Compact player docked above the navigation bar. Tapping it opens the full
 * player sheet.
 *
 * It sits above the permanent navigation drawer (which is why the z-index is
 * just under `modal`) and starts to the right of it on wide screens so the
 * "Now playing" bar is never hidden behind the side menu.
 *
 * Styling is a floating glass card that follows the current theme — accent
 * progress line on top, circular accent play button — instead of the old
 * hard coded dark strip.
 */
export default function MiniPlayer({ bottomOffset }) {
  const player = usePlayer();
  const track = player.current;

  if (!track) return null;

  const progress = player.duration ? (player.currentTime / player.duration) * 100 : 0;
  const buffered = player.duration
    ? Math.min((player.buffered / player.duration) * 100, 100)
    : 0;

  return (
    <Box
      onClick={() => player.setSheetOpen(true)}
      sx={{
        position: 'fixed',
        left: { xs: 8, sm: 12, md: 228 },
        right: { xs: 8, sm: 12, md: 12 },
        bottom: bottomOffset,
        zIndex: (t) => t.zIndex.modal - 1,
        color: 'text.primary',
        bgcolor: (t) => alpha(t.palette.background.paper, 0.86),
        borderRadius: 4,
        border: '1px solid',
        borderColor: 'divider',
        boxShadow:
          '0 12px 32px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.08)',
        overflow: 'hidden',
        cursor: 'pointer',
        backdropFilter: 'blur(20px) saturate(1.6)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.6)',
        transition:
          'left 250ms ease, opacity 200ms ease, transform 160ms ease, box-shadow 160ms ease',
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow:
            '0 16px 40px rgba(0,0,0,0.2), 0 3px 10px rgba(0,0,0,0.1)',
        },
        '&:hover .mini-expand': { opacity: 1 },
      }}
    >
      {/* buffered (behind) + played (front) progress */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          bgcolor: (t) => alpha(t.palette.text.primary, 0.08),
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            height: '100%',
            width: `${buffered}%`,
            bgcolor: (t) => alpha(t.palette.text.primary, 0.2),
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            height: '100%',
            width: `${progress}%`,
            bgcolor: 'primary.main',
            borderRadius: '0 3px 3px 0',
            boxShadow: (t) => `0 0 8px ${alpha(t.palette.primary.main, 0.65)}`,
            transition: 'width 250ms linear',
          }}
        />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.25, py: 1 }}>
        <Box sx={{ position: 'relative', width: 44, height: 44, flexShrink: 0 }}>
          <Artwork
            src={track.artwork}
            alt=""
            iconSize={20}
            sx={{ width: 44, height: 44, borderRadius: 2, bgcolor: 'action.hover' }}
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
          <Typography variant="caption" noWrap sx={{ display: 'block', color: 'text.secondary' }}>
            {track.artist}
          </Typography>
        </Box>

        <IconButton
          aria-label={player.isPlaying ? 'Pause' : 'Play'}
          onClick={(event) => {
            event.stopPropagation();
            player.togglePlay();
          }}
          sx={{
            width: 42,
            height: 42,
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            transition: 'transform 150ms ease, filter 150ms ease',
            '&:hover': { bgcolor: 'primary.main', transform: 'scale(1.08)', filter: 'brightness(1.08)' },
          }}
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
          sx={{
            color: 'text.secondary',
            width: 40,
            height: 40,
            '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
          }}
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
          sx={{
            color: 'text.secondary',
            width: 40,
            height: 40,
            opacity: { xs: 1, md: 0.55 },
            '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
          }}
        >
          <ExpandLessIcon />
        </IconButton>
      </Box>
    </Box>
  );
}
