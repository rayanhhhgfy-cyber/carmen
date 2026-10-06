import Artwork from "./Artwork";
import LyricsView from "./LyricsView";
import PlayerMenu from "./PlayerMenu";
import QueueTab from "./QueueTab";
import RelatedTab from "./RelatedTab";
import RepeatIcon from "@mui/icons-material/Repeat";
import RepeatOneIcon from "@mui/icons-material/RepeatOne";
import ShuffleIcon from "@mui/icons-material/Shuffle";
import { alpha } from "@mui/material/styles";
import { forwardRef, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePlayer } from "../player/PlayerContext";
import { formatTime } from "../utils/format";
import { pickArtwork } from "../utils/track";

import {
  Alert,
  AppBar,
  Box,
  Chip,
  CircularProgress,
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
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';

import {
  ChevronLeftIcon,
  ExpandMoreIcon,
  LyricsIcon,
  PauseIcon,
  PlayArrowIcon,
  QueueMusicIcon,
  RelatedIcon,
  SkipNextIcon,
  SkipPreviousIcon,
} from './icons';

const Transition = forwardRef(function Transition(props, ref) {
  return <Slide direction="up" ref={ref} {...props} />;
});

/** Tab order inside the player: 0 lyrics · 1 related · 2 queue. */
const LYRICS_TAB = 0;
const RELATED_TAB = 1;
const QUEUE_TAB = 2;

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
  /**
   * `null` means "no panel chosen yet": a phone then shows the plain player
   * and opens a panel only when one of the icon tabs is tapped, while the
   * desktop drawer defaults to **Related** — the panel people open the
   * player for.
   */
  const [tab, setTab] = useState(null);
  const activeTab = tab ?? (isDesktop ? RELATED_TAB : null);
  // Mobile only: a tab that was tapped takes over the whole screen with a
  // compact "now playing" card on top; the down arrow folds it back.
  const [expanded, setExpanded] = useState(false);

  const track = player.current;
  const meta = player.meta;
  const videoId = track?.videoId;

  useEffect(() => {
    setExpanded(false);
    setTab(null);
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
    // back to the default panel (Related on desktop, nothing on a phone)
    setExpanded(false);
    setTab(null);
    player.setSheetOpen(false);
  };

  if (!track) return null;

  // Largest artwork first: the API returns every size sorted smallest to
  // biggest, so the last entry of the list is the biggest one.
  // The song's own artwork: the i.ytimg CDN entry (maxresdefault), which is
  // also the largest item of the merged thumbnail list.
  const artwork = track.artwork || pickArtwork(meta?.thumbnails);

  const artworkBox = (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        maxWidth: {
          // a phone has room for the cover to carry the screen
          xs: 'min(74vw, 320px)',
          sm: 'min(60vw, 300px)',
          // wide card on a desktop, but never taller than the drawer allows
          // so the whole column fits without a scrollbar
          md: 'min(100%, 340px, calc(34vh + 40px))',
        },
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
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{ mt: 2, textAlign: { xs: 'center', md: 'left' } }}
    >
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

  /**
   * Seek bar: a hairline rail that fattens under the pointer, the buffered
   * range in a muted tint and a glowing accent track.  The thumb only
   * appears while the bar is hovered or focused — the modern desktop player
   * treatment instead of a permanently visible slider dot.
   */
  const progressBar = (
    <Box sx={{ mt: 2.5 }}>
      <Box
        sx={{
          position: 'relative',
          '& .seek-rail, & .seek-buffer': { transition: 'height 140ms ease' },
          '&:hover, &:focus-within': {
            '& .seek-rail, & .seek-buffer': { height: 6 },
          },
        }}
      >
        {/* empty rail */}
        <Box
          aria-hidden
          className="seek-rail"
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            height: 4,
            borderRadius: 3,
            bgcolor: 'action.hover',
            pointerEvents: 'none',
          }}
        />
        {/* downloaded / buffered range */}
        <Box
          aria-hidden
          className="seek-buffer"
          sx={{
            position: 'absolute',
            left: 0,
            width: `${buffered * 100}%`,
            top: '50%',
            transform: 'translateY(-50%)',
            height: 4,
            borderRadius: 3,
            bgcolor: (t) => alpha(t.palette.text.primary, 0.16),
            pointerEvents: 'none',
            transition: 'width 300ms linear, height 140ms ease',
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
              py: 1.25,
              '& .MuiSlider-rail': { bgcolor: 'transparent', opacity: 1 },
              '& .MuiSlider-track': {
                border: 0,
                height: 4,
                borderRadius: 3,
                boxShadow: (t) => `0 0 10px ${alpha(t.palette.primary.main, 0.55)}`,
              },
              '& .MuiSlider-thumb': {
                width: 12,
                height: 12,
                bgcolor: 'background.paper',
                border: (t) => `3px solid ${t.palette.primary.main}`,
                boxShadow: 'none',
                opacity: 0,
                scale: '0.5',
                transition: 'opacity 140ms ease, scale 140ms ease',
                '&:hover, &.MuiSlider-active': { opacity: 1, scale: '1' },
              },
              '&:hover .MuiSlider-thumb, &:focus-visible .MuiSlider-thumb': {
                opacity: 1,
                scale: '1',
              },
            }}
          />
        ) : (
          <LinearProgress
            sx={{ borderRadius: 3, height: 4, bgcolor: 'action.hover' }}
          />
        )}
      </Box>
      <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.25 }}>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {formatTime(player.currentTime)}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {duration ? formatTime(duration) : '--:--'}
        </Typography>
      </Stack>
    </Box>
  );

  /**
   * Transport: centred row with even rhythm, side buttons that fill with a
   * tint when active and a play button that carries the accent as a glow —
   * the round, softly floating control of a modern player.
   */
  const transport = (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="center"
      spacing={{ xs: 0.25, sm: 0.75 }}
      sx={{ maxWidth: 440, width: '100%', mx: 'auto', mt: 1.5 }}
    >
      <IconButton
        aria-label="Shuffle"
        onClick={player.toggleShuffle}
        sx={{
          width: 44,
          height: 44,
          color: player.shuffle ? 'primary.main' : 'text.secondary',
          bgcolor: (t) =>
            player.shuffle ? alpha(t.palette.primary.main, 0.14) : 'transparent',
          transition: 'background-color 160ms ease, color 160ms ease',
          '&:hover': {
            bgcolor: (t) =>
              player.shuffle
                ? alpha(t.palette.primary.main, 0.22)
                : alpha(t.palette.text.primary, 0.08),
          },
        }}
      >
        <ShuffleIcon fontSize="small" />
      </IconButton>

      <IconButton
        aria-label="Previous"
        onClick={player.previous}
        sx={{
          width: 48,
          height: 48,
          color: 'text.primary',
          transition: 'background-color 160ms ease',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <SkipPreviousIcon sx={{ fontSize: 32 }} />
      </IconButton>

      <Fab
        color="primary"
        aria-label={player.isPlaying ? 'Pause' : 'Play'}
        onClick={player.togglePlay}
        sx={{
          width: 66,
          height: 66,
          mx: 1,
          boxShadow: (t) => `0 10px 26px ${alpha(t.palette.primary.main, 0.42)}`,
          transition:
            'transform 160ms cubic-bezier(.2,.8,.2,1), box-shadow 160ms ease',
          '&:hover': {
            transform: 'scale(1.06)',
            boxShadow: (t) => `0 14px 32px ${alpha(t.palette.primary.main, 0.55)}`,
          },
        }}
      >
        {player.buffering && !player.isPlaying ? (
          <CircularProgress size={26} color="inherit" />
        ) : player.isPlaying ? (
          <PauseIcon sx={{ fontSize: 34 }} />
        ) : (
          <PlayArrowIcon sx={{ fontSize: 36 }} />
        )}
      </Fab>

      <IconButton
        aria-label="Next"
        onClick={() => player.next()}
        sx={{
          width: 48,
          height: 48,
          color: 'text.primary',
          transition: 'background-color 160ms ease',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <SkipNextIcon sx={{ fontSize: 32 }} />
      </IconButton>

      <IconButton
        aria-label={`Repeat: ${player.repeat}`}
        onClick={player.cycleRepeat}
        sx={{
          width: 44,
          height: 44,
          color: player.repeat === 'off' ? 'text.secondary' : 'primary.main',
          bgcolor: (t) =>
            player.repeat === 'off'
              ? 'transparent'
              : alpha(t.palette.primary.main, 0.14),
          transition: 'background-color 160ms ease, color 160ms ease',
          '&:hover': {
            bgcolor: (t) =>
              player.repeat === 'off'
                ? alpha(t.palette.text.primary, 0.08)
                : alpha(t.palette.primary.main, 0.22),
          },
        }}
      >
        {player.repeat === 'one' ? (
          <RepeatOneIcon fontSize="small" />
        ) : (
          <RepeatIcon fontSize="small" />
        )}
      </IconButton>
    </Stack>
  );

  /**
   * Bottom utility block — the "⋯" menu.
   *
   * It used to be the volume pill with two standalone buttons (info +
   * download) under it; the pill is gone (the player plays at full level and
   * the OS mixer owns volume) and everything about the song that is not a
   * transport control lives in the menu, down here where the thumb lands.
   */
  const utilityRow = (
    <Stack alignItems="center" sx={{ mt: 1.75, width: '100%' }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="center"
        spacing={1}
      >
        <PlayerMenu track={track} meta={meta} />
      </Stack>
    </Stack>
  );

  // Lyrics / related / queue as icon only tabs (labels would just repeat
  // what the panel already shows).  On a phone tapping one opens it full
  // screen — see `expanded`.
  const handleTabChange = (_, value) => {
    setTab(value);
    if (!isDesktop) setExpanded(true);
  };

  const tabItems = [
    { index: LYRICS_TAB, label: 'Lyrics', icon: <LyricsIcon /> },
    { index: RELATED_TAB, label: 'Related', icon: <RelatedIcon /> },
    { index: QUEUE_TAB, label: 'Queue', icon: <QueueMusicIcon /> },
  ];

  /**
   * The three panel tabs.
   *
   * `activeTab` is `null` on a phone until one of them is tapped, and MUI's
   * `<Tabs>` rejects the "nothing selected" `value={-1}` — it warns about
   * children with index 0, 1, 2 not matching the value.  So while nothing is
   * selected the same three icons are plain buttons with the same footprint;
   * the moment one is chosen the real `<Tabs>` takes over with a proper
   * `value`.
   */
  const tabs =
    activeTab === null ? (
      <Stack
        direction="row"
        aria-label="Player panels"
        sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}
      >
        {tabItems.map((item) => (
          <Tooltip title={item.label} key={item.label}>
            <IconButton
              aria-label={item.label}
              onClick={() => handleTabChange(null, item.index)}
              sx={{
                flex: 1,
                borderRadius: 0,
                minHeight: 52,
                color: 'text.secondary',
              }}
            >
              {item.icon}
            </IconButton>
          </Tooltip>
        ))}
      </Stack>
    ) : (
      <Tabs
        value={activeTab}
        onChange={handleTabChange}
        variant="fullWidth"
        aria-label="Player panels"
        sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}
      >
        {tabItems.map((item) => (
          <IconTab key={item.label} label={item.label} icon={item.icon} value={item.index} />
        ))}
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
        onClick={() => {
          setExpanded(false);
          setTab(null);
        }}
        sx={{ border: 1, borderColor: 'divider' }}
      >
        <ExpandMoreIcon />
      </IconButton>
    </Stack>
  );

  const panel =
    activeTab === null ? null : (
      // related and queue stay mounted (hidden) so switching tabs never
      // re-fetches; lyrics mounts only while its tab is open because
      // `react-lrc` has to measure real layout to auto scroll — a
      // `display: none` panel has none, so it would land on the wrong line
      <Box sx={{ flex: 1, minHeight: 240, mt: 1 }}>
        {activeTab === LYRICS_TAB && (
          <Box sx={{ height: '100%' }}>
            <LyricsView synced={lyrics.synced} unsynced={lyrics.unsynced} source={lyrics.source} />
          </Box>
        )}
        <Box sx={{ display: activeTab === RELATED_TAB ? 'block' : 'none', height: '100%' }}>
          <RelatedTab />
        </Box>
        <Box sx={{ display: activeTab === QUEUE_TAB ? 'block' : 'none', height: '100%' }}>
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
        {/* the download / detail buttons live in the utility row as the "⋯"
            menu, so the header only carries the way out */}
        <Box sx={{ flex: 1 }} />
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
            width: { md: 800, lg: 960 },
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
              gridTemplateColumns: 'minmax(0, 360px) minmax(0, 1fr)',
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
              {progressBar}
              {transport}
              {utilityRow}
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
              // on a short screen the column scrolls instead of clipping
              overflowY: 'auto',
            }}
          >
            {artworkBox}
            {titleBlock}
            {errorAlert}
            {progressBar}
            {transport}
            {utilityRow}
            {/* Panel tabs hug the bottom edge — the thumb reaches them and
                the column no longer trails off into empty space. */}
            <Box sx={{ mt: 'auto', pt: 1.5 }}>{tabs}</Box>
            {panel}
          </Box>
        )}
      </Box>
    </Dialog>
  );
}
