import { forwardRef, useMemo, useState } from 'react';
import {
  Alert,
  AppBar,
  Box,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  Fab,
  IconButton,
  LinearProgress,
  Slider,
  Stack,
  Slide,
  Tab,
  Tabs,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious';
import ShuffleIcon from '@mui/icons-material/Shuffle';
import RepeatIcon from '@mui/icons-material/Repeat';
import RepeatOneIcon from '@mui/icons-material/RepeatOne';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { alpha } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';

import { usePlayer } from '../player/PlayerContext';
import { formatTime } from '../utils/format';
import DownloadButton from './DownloadButton';
import LyricsView from './LyricsView';
import RelatedTab from './RelatedTab';
import QueueTab from './QueueTab';

const Transition = forwardRef(function Transition(props, ref) {
  return <Slide direction="up" ref={ref} {...props} />;
});

function PanelTab({ label, ...props }) {
  return <Tab disableRipple sx={{ minHeight: 44, px: 2.5 }} label={label} {...props} />;
}

/**
 * Full screen player: artwork, touch friendly transport controls, progress,
 * synced lyrics, related songs and the queue.
 */
export default function PlayerSheet() {
  const player = usePlayer();
  const theme = useTheme();
  const navigate = useNavigate();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [tab, setTab] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const track = player.current;
  const meta = player.meta;
  const duration = player.duration || track?.durationSeconds || 0;
  const progress = duration ? Math.min(player.currentTime, duration) : 0;

  const lyrics = useMemo(
    () => meta?.lyrics || { synced: null, unsynced: null, source: null },
    [meta],
  );

  const handleClose = () => player.setSheetOpen(false);

  if (!track) return null;

  const artwork = meta?.thumbnails?.[0]?.url || track.artwork;

  return (
    <Dialog
      fullScreen={fullScreen}
      open={player.sheetOpen}
      onClose={handleClose}
      TransitionComponent={Transition}
      fullWidth
      maxWidth="sm"
      PaperProps={{
        sx: {
          maxHeight: fullScreen ? '100%' : '92vh',
          borderRadius: fullScreen ? 0 : 3,
          bgcolor: 'background.default',
          overflow: 'hidden',
        },
      }}
    >
      <Box sx={{ position: 'relative', display: 'flex', flexDirection: 'column', height: fullScreen ? '100vh' : '86vh', maxHeight: '100%' }}>
        {/* ── Blurred artwork backdrop ─────────────────────────────────── */}
        <Box aria-hidden sx={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          {artwork && (
            <Box
              component="img"
              src={artwork}
              alt=""
              sx={{
                position: 'absolute',
                top: '-25%',
                left: '-25%',
                width: '150%',
                height: '150%',
                objectFit: 'cover',
                filter: 'blur(70px) saturate(1.5)',
                opacity: 0.55,
              }}
            />
          )}
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(180deg, ${alpha(theme.palette.background.default, 0.55)} 0%, ${alpha(theme.palette.background.default, 0.9)} 45%, ${theme.palette.background.default} 100%)`,
            }}
          />
        </Box>

        {/* ── Header ───────────────────────────────────────────────────── */}
        <AppBar
          position="static"
          elevation={0}
          color="transparent"
          sx={{ zIndex: 2, backdropFilter: 'blur(6px)' }}
        >
          <Stack direction="row" alignItems="center" sx={{ px: 1, py: 0.5 }}>
            <IconButton edge="start" aria-label="Close player" onClick={handleClose}>
              {fullScreen ? <ExpandMoreIcon /> : <CloseIcon />}
            </IconButton>
            <Box sx={{ flex: 1, textAlign: 'center' }}>
              <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 1.2 }}>
                NOW PLAYING
              </Typography>
            </Box>
            <IconButton
              aria-label="Track details"
              color={detailsOpen ? 'primary' : 'default'}
              onClick={() => setDetailsOpen((value) => !value)}
            >
              <InfoOutlinedIcon fontSize="small" />
            </IconButton>
            <DownloadButton edge="end" track={track} meta={meta} />
          </Stack>
        </AppBar>

        {/* ── Body ─────────────────────────────────────────────────────── */}
        <Box sx={{ position: 'relative', zIndex: 1, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', px: 3, pt: 1, pb: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
            <Box sx={{ position: 'relative', width: fullScreen ? 'min(66vw, 300px)' : 260 }}>
              <Box
                component="img"
                src={artwork || undefined}
                alt={track.albumName || track.title}
                sx={{
                  width: '100%',
                  aspectRatio: '1 / 1',
                  objectFit: 'cover',
                  borderRadius: 3,
                  bgcolor: 'action.hover',
                  boxShadow: 10,
                }}
              />
              {player.buffering && (
                <CircularProgress
                  size={42}
                  sx={{ position: 'absolute', inset: 0, margin: 'auto', color: 'primary.main' }}
                />
              )}
            </Box>
          </Box>

          <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 2.5 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="h6" noWrap>
                {track.title}
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                noWrap
                onClick={() => {
                  if (!track.artist) return;
                  player.setSheetOpen(false);
                  navigate(`/search?query=${encodeURIComponent(track.artist)}`);
                }}
                sx={{ cursor: track.artist ? 'pointer' : 'default', '&:hover': { color: 'primary.main' } }}
              >
                {track.artist}
              </Typography>
            </Box>
            {track.isExplicit && <Chip label="E" size="small" />}
          </Stack>

          {player.error && (
            <Alert severity="error" onClose={player.dismissError} sx={{ mt: 1.5, py: 0 }}>
              {player.error}
            </Alert>
          )}

          <Collapse in={detailsOpen} sx={{ mt: 1 }}>
            <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.8 }}>
                {[
                  meta?.album?.name || track.albumName,
                  meta?.year,
                  meta?.genre,
                  track.duration ? formatTime(track.duration) : null,
                ]
                  .filter(Boolean)
                  .join('  •  ')}
              </Typography>
              {meta?.description && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, whiteSpace: 'pre-line', maxHeight: 90, overflow: 'hidden' }}>
                  {meta.description}
                </Typography>
              )}
            </Box>
          </Collapse>

          {/* Progress */}
          <Box sx={{ mt: 2 }}>
            {duration ? (
              <Slider
                size="small"
                value={progress}
                max={duration}
                step={0.5}
                onChange={(_, value) => player.seek(Number(value))}
                aria-label="Seek"
                sx={{ color: 'primary.main', py: 1 }}
              />
            ) : (
              <LinearProgress sx={{ borderRadius: 2, height: 4, bgcolor: 'action.hover' }} />
            )}
            <Stack direction="row" justifyContent="space-between" sx={{ mt: -0.5 }}>
              <Typography variant="caption" color="text.secondary">
                {formatTime(player.currentTime)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {duration ? formatTime(duration) : '--:--'}
              </Typography>
            </Stack>
          </Box>

          {/* Transport */}
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{ maxWidth: 400, width: '100%', mx: 'auto', mt: 1 }}
          >
            <IconButton
              aria-label="Shuffle"
              onClick={player.toggleShuffle}
              color={player.shuffle ? 'primary' : 'default'}
            >
              <ShuffleIcon fontSize="small" />
            </IconButton>
            <IconButton aria-label="Previous" onClick={player.previous}>
              <SkipPreviousIcon />
            </IconButton>
            <Fab
              color="primary"
              aria-label={player.isPlaying ? 'Pause' : 'Play'}
              onClick={player.togglePlay}
              sx={{ width: 62, height: 62, boxShadow: 6 }}
            >
              {player.buffering && !player.isPlaying ? (
                <CircularProgress size={26} color="inherit" />
              ) : player.isPlaying ? (
                <PauseIcon sx={{ fontSize: 32 }} />
              ) : (
                <PlayArrowIcon sx={{ fontSize: 34 }} />
              )}
            </Fab>
            <IconButton aria-label="Next" onClick={() => player.next()}>
              <SkipNextIcon />
            </IconButton>
            <IconButton
              aria-label={`Repeat: ${player.repeat}`}
              onClick={player.cycleRepeat}
              color={player.repeat === 'off' ? 'default' : 'primary'}
            >
              {player.repeat === 'one' ? <RepeatOneIcon fontSize="small" /> : <RepeatIcon fontSize="small" />}
            </IconButton>
          </Stack>

          {/* Volume (pointer devices) */}
          <Stack
            direction="row"
            alignItems="center"
            spacing={1}
            sx={{ display: { xs: 'none', sm: 'flex' }, maxWidth: 300, width: '100%', mx: 'auto', mt: 0.5 }}
          >
            <IconButton
              size="small"
              aria-label="Mute"
              onClick={() => player.setVolume(player.volume > 0 ? 0 : 1)}
            >
              {player.volume > 0 ? <VolumeUpIcon fontSize="small" /> : <VolumeOffIcon fontSize="small" />}
            </IconButton>
            <Slider
              size="small"
              value={player.volume}
              min={0}
              max={1}
              step={0.05}
              onChange={(_, value) => player.setVolume(Number(value))}
              aria-label="Volume"
            />
          </Stack>

          {/* Tabs */}
          <Tabs
            value={tab}
            onChange={(_, value) => setTab(value)}
            variant="fullWidth"
            sx={{ mt: 1, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}
          >
            <PanelTab label="Lyrics" />
            <PanelTab label="Related" />
            <PanelTab label="Queue" />
          </Tabs>

          <Box sx={{ flex: 1, minHeight: 220, mt: 1 }}>
            <Box sx={{ display: tab === 0 ? 'block' : 'none', height: '100%' }}>
              <LyricsView
                synced={lyrics.synced}
                unsynced={lyrics.unsynced}
                source={lyrics.source}
              />
            </Box>
            <Box sx={{ display: tab === 1 ? 'block' : 'none', height: '100%' }}>
              <RelatedTab />
            </Box>
            <Box sx={{ display: tab === 2 ? 'block' : 'none', height: '100%' }}>
              <QueueTab />
            </Box>
          </Box>
        </Box>
      </Box>
    </Dialog>
  );
}
