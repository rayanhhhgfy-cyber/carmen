import { forwardRef, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppBar,
  Box,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  Drawer,
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
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import LyricsIcon from '@mui/icons-material/Lyrics';
import QueueMusicIcon from '@mui/icons-material/QueueMusic';
import ExploreIcon from '@mui/icons-material/Explore';
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
import { pickArtwork } from '../utils/track';
import Artwork from './Artwork';
import DownloadButton from './DownloadButton';
import LyricsView from './LyricsView';
import RelatedTab from './RelatedTab';
import QueueTab from './QueueTab';

const Transition = forwardRef(function Transition(props, ref) {
  return <Slide direction="up" ref={ref} {...props} />;
});

function IconTab({ icon, label, ...props }) {
  return (
    <Tab
      disableRipple
      aria-label={label}
      icon={icon}
      sx={{ minHeight: 52, minWidth: 0, '& .MuiTab-icon': { fontSize: 22 } }}
      {...props}
    />
  );
}

/**
 * Full screen player.
 *
 * * on phones it slides up as a full screen dialog;
 * * on desktop it opens as a **drawer docked to the left**, split into two
 *   columns: the artwork and the transport on the left, and the lyrics /
 *   related / queue panel on the right — so the related list gets the full
 *   height of the window instead of the few hundred pixels left over.
 */
export default function PlayerSheet() {
  const player = usePlayer();
  const theme = useTheme();
  const navigate = useNavigate();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const [tab, setTab] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Mobile only: a tab that was tapped takes over the whole screen with a
  // compact "now playing" card on top; the down arrow folds it back.
  const [expanded, setExpanded] = useState(false);

  const track = player.current;
  const meta = player.meta;
  const videoId = track?.videoId;

  useEffect(() => {
    setExpanded(false);
  }, [videoId]);
  const duration = player.duration || track?.durationSeconds || 0;
  const progress = duration ? Math.min(player.currentTime, duration) : 0;
  const buffered = duration
    ? Math.min(Math.max(player.buffered, 0) / duration, 1)
    : 0;

  const lyrics = useMemo(
    () => meta?.lyrics || { synced: null, unsynced: null, source: null },
    [meta],
  );

  const handleClose = () => {
    setExpanded(false);
    player.setSheetOpen(false);
  };

  if (!track) return null;

  // Largest artwork first: the API returns every size sorted smallest to
  // biggest, so the last entry of the list is the biggest one.
  // The song's own artwork: the i.ytimg CDN entry (maxresdefault), which is
  // also the largest item of the merged thumbnail list.
  const artwork = track.artwork || pickArtwork(meta?.thumbnails);

  const infoLine = [
    meta?.album?.name || track.albumName,
    meta?.year,
    meta?.genre,
    track.duration ? formatTime(track.duration) : null,
  ]
    .filter(Boolean)
    .join('  •  ');

  const artworkBox = (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        maxWidth: { xs: 'min(58vw, 260px)', sm: 'min(60vw, 300px)', md: 320 },
        mx: 'auto',
      }}
    >
      <Artwork
        src={artwork}
        alt={track.albumName || track.title}
        iconSize={72}
        sx={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 3, boxShadow: 10 }}
      />
      {player.buffering && (
        <CircularProgress
          size={44}
          sx={{ position: 'absolute', inset: 0, margin: 'auto', color: 'primary.main' }}
        />
      )}
    </Box>
  );

  const titleBlock = (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 2 }}>
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
  );

  const errorAlert = player.error ? (
    <Alert severity="error" onClose={player.dismissError} sx={{ mt: 1.5, py: 0 }}>
      {player.error}
    </Alert>
  ) : null;

  const details = (
    <Collapse in={detailsOpen} sx={{ mt: 1 }}>
      <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.8 }}>
          {infoLine}
        </Typography>
        {meta?.description && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 0.5, whiteSpace: 'pre-line', maxHeight: 90, overflow: 'hidden' }}
          >
            {meta.description}
          </Typography>
        )}
      </Box>
    </Collapse>
  );

  const progressBar = (
    <Box sx={{ mt: 2 }}>
      <Box sx={{ position: 'relative' }}>
        {/* empty rail */}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            height: 4,
            borderRadius: 2,
            bgcolor: 'action.hover',
            pointerEvents: 'none',
          }}
        />
        {/* downloaded / buffered range */}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            left: 0,
            width: `${buffered * 100}%`,
            top: '50%',
            transform: 'translateY(-50%)',
            height: 4,
            borderRadius: 2,
            bgcolor: 'rgba(128,128,128,0.55)',
            pointerEvents: 'none',
            transition: 'width 300ms linear',
          }}
        />
        {duration ? (
          <Slider
            size="small"
            value={progress}
            max={duration}
            step={0.5}
            onChange={(_, value) => player.seek(Number(value))}
            aria-label="Seek"
            sx={{
              position: 'relative',
              color: 'primary.main',
              py: 1,
              '& .MuiSlider-rail': { bgcolor: 'transparent', opacity: 1 },
              '& .MuiSlider-track': { border: 0 },
            }}
          />
        ) : (
          <LinearProgress sx={{ borderRadius: 2, height: 4, bgcolor: 'action.hover' }} />
        )}
      </Box>
      <Stack direction="row" justifyContent="space-between" sx={{ mt: -0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {formatTime(player.currentTime)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {duration ? formatTime(duration) : '--:--'}
        </Typography>
      </Stack>
    </Box>
  );

  const transport = (
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
  );

  const volume = (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{
        display: { xs: 'none', sm: 'flex' },
        maxWidth: 300,
        width: '100%',
        mx: 'auto',
        mt: 0.5,
      }}
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
  );

  // Lyrics / related / queue as icon only tabs (labels would just repeat
  // what the panel already shows).  On a phone tapping one opens it full
  // screen — see `expanded`.
  const handleTabChange = (_, value) => {
    setTab(value);
    if (!isDesktop) setExpanded(true);
  };

  const tabs = (
    <Tabs
      value={tab}
      onChange={handleTabChange}
      variant="fullWidth"
      aria-label="Player panels"
      sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}
    >
      <IconTab label="Lyrics" icon={<LyricsIcon />} />
      <IconTab label="Related" icon={<ExploreIcon />} />
      <IconTab label="Queue" icon={<QueueMusicIcon />} />
    </Tabs>
  );

  // Compact "now playing" card shown on top of an expanded phone panel:
  // artwork, title, artist and the down arrow that folds it back.
  const nowPlayingCard = (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1.5}
      sx={{
        px: 2,
        py: 1.25,
        bgcolor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
        flexShrink: 0,
      }}
    >
      <Artwork
        src={artwork}
        alt=""
        iconSize={22}
        sx={{ width: 46, height: 46, borderRadius: 1.5, flexShrink: 0 }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle2" noWrap>
          {track.title}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
          {track.artist}
        </Typography>
      </Box>
      <IconButton
        aria-label="Collapse panel"
        onClick={() => setExpanded(false)}
        sx={{ border: 1, borderColor: 'divider' }}
      >
        <ExpandMoreIcon />
      </IconButton>
    </Stack>
  );

  const panel = (
    <Box sx={{ flex: 1, minHeight: 240, mt: 1 }}>
      <Box sx={{ display: tab === 0 ? 'block' : 'none', height: '100%' }}>
        <LyricsView synced={lyrics.synced} unsynced={lyrics.unsynced} source={lyrics.source} />
      </Box>
      <Box sx={{ display: tab === 1 ? 'block' : 'none', height: '100%' }}>
        <RelatedTab />
      </Box>
      <Box sx={{ display: tab === 2 ? 'block' : 'none', height: '100%' }}>
        <QueueTab />
      </Box>
    </Box>
  );

  const header = (
    <AppBar
      position="static"
      elevation={0}
      color="transparent"
      sx={{ zIndex: 2, backdropFilter: 'blur(6px)', flexShrink: 0 }}
    >
      <Stack direction="row" alignItems="center" sx={{ px: 1, py: 0.5 }}>
        <IconButton edge="start" aria-label="Close player" onClick={handleClose}>
          {isDesktop ? <ChevronLeftIcon /> : <ExpandMoreIcon />}
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
  );

  const backdrop = (
    <Box
      aria-hidden
      sx={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}
    >
      {artwork && (
        <Artwork
          src={artwork}
          alt=""
          icon={null}
          sx={{ position: 'absolute', top: '-25%', left: '-25%', width: '150%', height: '150%' }}
          imgSx={{ filter: 'blur(70px) saturate(1.5)', opacity: 0.55 }}
        />
      )}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(180deg, ${alpha(theme.palette.background.default, 0.5)} 0%, ${alpha(theme.palette.background.default, 0.88)} 45%, ${theme.palette.background.default} 100%)`,
        }}
      />
    </Box>
  );

  if (isDesktop) {
    return (
      <Drawer
        anchor="left"
        variant="temporary"
        open={player.sheetOpen}
        onClose={handleClose}
        PaperProps={{
          sx: {
            width: { md: 720, lg: 840 },
            maxWidth: '100vw',
            boxSizing: 'border-box',
            bgcolor: 'background.default',
            borderRight: 1,
            borderColor: 'divider',
            overflow: 'hidden',
          },
        }}
      >
        <Box
          sx={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            minHeight: 0,
          }}
        >
          {backdrop}
          {header}

          <Box
            sx={{
              position: 'relative',
              zIndex: 1,
              flex: 1,
              minHeight: 0,
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 300px) minmax(0, 1fr)',
              gap: 3,
              px: 3,
              pt: 1,
              pb: 2,
            }}
          >
            {/* ── Left: artwork + transport ─────────────────────────── */}
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                overflowY: 'auto',
                pr: 0.5,
              }}
            >
              {artworkBox}
              {titleBlock}
              {errorAlert}
              {details}
              {progressBar}
              {transport}
              {volume}
            </Box>

            {/* ── Right: lyrics / related / queue ───────────────────── */}
            <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              {tabs}
              {panel}
            </Box>
          </Box>
        </Box>
      </Drawer>
    );
  }

  return (
    <Dialog
      fullScreen
      open={player.sheetOpen}
      onClose={handleClose}
      TransitionComponent={Transition}
      PaperProps={{
        sx: { bgcolor: 'background.default', overflow: 'hidden' },
      }}
    >
      <Box
        sx={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
        }}
      >
        {backdrop}
        {!expanded && header}

        {expanded ? (
          /* Lyrics / related / queue take the whole screen with a compact
             now playing card on top — the down arrow folds it all back. */
          <Box
            sx={{
              position: 'relative',
              zIndex: 1,
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {nowPlayingCard}
            {tabs}
            {panel}
          </Box>
        ) : (
          <Box
            sx={{
              position: 'relative',
              zIndex: 1,
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              px: 3,
              pt: 1,
              pb: 2,
            }}
          >
            {artworkBox}
            {titleBlock}
            {errorAlert}
            {details}
            {progressBar}
            {transport}
            {volume}
            {tabs}
            {panel}
          </Box>
        )}
      </Box>
    </Dialog>
  );
}
