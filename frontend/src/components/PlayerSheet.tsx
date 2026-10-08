import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
  type TouchEvent,
} from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  IconButton,
  Slide,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
  type SlideProps,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';

import { streamUrl } from '../api';
import { localAssetSource } from '../offline/source';
import { usePlayer } from '../player/PlayerContext';
import { useEffectsEnabled } from '../settings/store';
import { useTheme as useAppTheme } from '../theme/ThemeContext';
import { lyricsOf } from '../utils/lyrics';
import { pickArtwork } from '../utils/track';
import Artwork from './Artwork';
import DownloadButton from './DownloadButton';
import LyricsView from './LyricsView';
import NPControls from './NPControls';
import NPFavorite from './NPFavorite';
import NPQueue from './NPQueue';
import NPScrubber from './NPScrubber';
import PlayerMenu from './PlayerMenu';
import RelatedTab from './RelatedTab';
import {
  CloseIcon,
  ExpandMoreIcon,
  ExplicitIcon,
  LyricsIcon,
  QueueMusicIcon,
  RelatedIcon,
  RefreshIcon,
} from './icons';

/** Tab order inside the player: 0 lyrics · 1 queue · 2 related. */
const LYRICS_TAB = 0;
const QUEUE_TAB = 1;
const RELATED_TAB = 2;

/** Pixels of downward swipe on the handle that dismiss the sheet. */
const DISMISS_DISTANCE = 72;

/** The phone sheet slides up from the bottom edge of the window. */
const SheetTransition = forwardRef<unknown, SlideProps>(function SheetTransition(props, ref) {
  return <Slide direction="up" ref={ref} {...props} />;
});

const TAB_SX = { minHeight: 50, minWidth: 0, textTransform: 'none', fontWeight: 600 } as const;

/**
 * The full "Now Playing" experience, in two shapes switched at the `md`
 * breakpoint:
 *
 * * **Phone** — a full-screen sheet that slides up. A grab *handle* sits on
 *   the top edge: tap it or swipe it down to dismiss (the sheet follows the
 *   finger while the swipe is in flight). Below it: artwork with its
 *   ambient glow, title / artist / album, scrubber, transport, and the
 *   secondary row — lyrics · queue · related · favorite · download — all of
 *   it inside thumb reach. The three panels take the screen over from a
 *   compact now-playing card when one of those buttons is tapped.
 * * **Desktop / tablet** — a *centred* modal sized inside the window
 *   (`min(1120px, 100vw − 64px)` × `min(760px, 100vh − 64px)`), split into
 *   two columns: the cover with its ambient glow on the left, and
 *   info → scrubber → transport → lyrics / queue / related on the right.
 *   Both columns manage their own overflow, so nothing spills even when the
 *   window is short.
 *
 * Mounting is unchanged: `Layout` renders this once and the player
 * context's `sheetOpen` / `setSheetOpen` drive the open/close mechanics.
 */
export default function PlayerSheet() {
  const player = usePlayer();
  const theme = useTheme();
  // Line art on the sheet surface (focus ring, spinner, artist hover) needs
  // the readable accent — white on a light sheet would be invisible.
  const { accentFg } = useAppTheme();
  const navigate = useNavigate();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  // The blurred artwork layers (glow behind the cover, wash behind the
  // sheet) are the expensive part of this screen — high performance mode
  // drops them and keeps the plain surfaces.
  const effectsEnabled = useEffectsEnabled();

  const [tab, setTab] = useState<number>(LYRICS_TAB);
  /** Phone only: a panel (lyrics / queue / related) has taken the screen. */
  const [panelOpen, setPanelOpen] = useState(false);

  const track = player.current;
  const meta = player.meta;
  const videoId = track?.videoId;
  const duration = player.duration || track?.durationSeconds || 0;

  // ── Swipe-to-dismiss bookkeeping (phone handle) ─────────────────────────
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const dragStartY = useRef<number | null>(null);
  const dragDistance = useRef(0);
  /** True between a real swipe and the click the browser synthesises after it. */
  const draggedRef = useRef(false);

  // A new song drops straight back to the default panel (lyrics).
  useEffect(() => {
    setPanelOpen(false);
    setTab(LYRICS_TAB);
  }, [videoId]);

  const lyrics = useMemo(() => lyricsOf(meta), [meta]);

  const handleClose = () => {
    setPanelOpen(false);
    setTab(LYRICS_TAB);
    player.setSheetOpen(false);
  };

  /** Phone: secondary-row buttons open their panel full screen. */
  const openPanel = (nextTab: number) => {
    setTab(nextTab);
    setPanelOpen(true);
  };

  const onTabChange = (_event: SyntheticEvent, value: number) => setTab(value);

  if (!track) return null;

  // Largest artwork first: the API returns every size sorted smallest to
  // biggest, so prefer the song's own i.ytimg cover (maxresdefault) and let
  // `pickArtwork` fall back to the meta thumbnails.
  const artwork = track.artwork || pickArtwork({ thumbnails: meta?.thumbnails });

  const searchArtist = () => {
    if (!track.artist) return;
    player.setSheetOpen(false);
    navigate(`/search?query=${encodeURIComponent(track.artist)}`);
  };

  /**
   * Re-point the element at a fresh source and press play.
   *
   * The context's own loader cannot re-run — the track id never changed —
   * so this mirrors its offline-first order: the downloaded file when one
   * exists, the server stream otherwise.  If the retry fails the element's
   * `error` event routes back into the context's full fallback chain and
   * the alert comes back with whatever message that produced.
   */
  const retry = () => {
    player.dismissError();
    const audio = player.audioRef.current;
    if (!audio) return;
    audio.src = localAssetSource(track.videoId)?.url ?? streamUrl(track.videoId);
    audio.load();
    const attempt = audio.play();
    if (attempt) attempt.catch(() => {});
  };

  // ── Phone swipe gestures ───────────────────────────────────────────────
  const onStripTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    dragStartY.current = event.touches[0]?.clientY ?? null;
    draggedRef.current = false;
    dragDistance.current = 0;
    const node = sheetRef.current;
    if (node) node.style.transition = 'none';
  };

  const onStripTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const start = dragStartY.current;
    const node = sheetRef.current;
    if (start === null || !node) return;
    const delta = (event.touches[0]?.clientY ?? start) - start;
    if (delta <= 0) {
      // dragging up does nothing (no rubber band), so the sheet stays put
      dragDistance.current = 0;
      node.style.transform = '';
      node.style.opacity = '';
      return;
    }
    draggedRef.current = true;
    dragDistance.current = delta;
    // Direct style writes instead of state: a re-render per touchmove would
    // repaint the whole player (lyrics list included) on every frame.
    node.style.transform = `translateY(${delta}px)`;
    node.style.opacity = String(Math.max(0.35, 1 - delta / 480));
  };

  const onStripTouchEnd = () => {
    const node = sheetRef.current;
    const distance = dragDistance.current;
    if (node) {
      node.style.transition = 'transform 240ms cubic-bezier(.2,.8,.2,1), opacity 240ms ease';
      node.style.transform = '';
      node.style.opacity = '';
    }
    dragStartY.current = null;
    dragDistance.current = 0;
    if (distance > DISMISS_DISTANCE) handleClose();
  };

  const onStripClick = () => {
    // the click a browser synthesises after a swipe must not close twice
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    handleClose();
  };

  // ── Pieces ─────────────────────────────────────────────────────────────

  /**
   * The handle strip: tap it, press Enter on it, or drag it down — all
   * three dismiss the sheet. It is a dedicated swipe zone (`touch-action:
   * none`), so a gesture that starts here moves the sheet instead of
   * scrolling the content underneath.
   */
  const strip = (
    <Box
      role="button"
      tabIndex={0}
      aria-label="Close player"
      onClick={onStripClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleClose();
        }
      }}
      onTouchStart={onStripTouchStart}
      onTouchMove={onStripTouchMove}
      onTouchEnd={onStripTouchEnd}
      sx={{
        position: 'relative',
        zIndex: 2,
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        pt: 1.25,
        pb: 0.5,
        cursor: 'pointer',
        touchAction: 'none',
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: accentFg,
          outlineOffset: -2,
          borderRadius: 2,
        },
      }}
    >
      <Box aria-hidden sx={{ width: 44, height: 4, borderRadius: 4, bgcolor: 'action.disabled' }} />
    </Box>
  );

  const header = (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{ position: 'relative', zIndex: 2, px: 1.25, py: 0.75, flexShrink: 0 }}
    >
      <IconButton edge="start" aria-label="Close player" onClick={handleClose}>
        {isDesktop ? <CloseIcon /> : <ExpandMoreIcon />}
      </IconButton>
      <Typography
        variant="caption"
        sx={{
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: 'text.secondary',
        }}
      >
        Now playing
      </Typography>
      <Box sx={{ flex: 1 }} />
      <PlayerMenu track={track} meta={meta} />
    </Stack>
  );

  /**
   * The cover with its ambient glow: a blurred, slightly oversized copy of
   * the same artwork bleeding out from behind the sharp one — the room
   * takes the colour of the sleeve without any extra chrome. High
   * performance mode renders only the sharp cover; without the glow the
   * sheet's own background is the surface behind it.
   */
  const artworkBox = (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        maxWidth: { xs: 'min(74vw, 320px)', sm: 'min(60vw, 340px)', md: 'min(100%, 440px)' },
        mx: 'auto',
      }}
    >
      {artwork && effectsEnabled && (
        <Artwork
          src={artwork}
          alt=""
          icon={null}
          aria-hidden
          sx={{
            position: 'absolute',
            inset: { xs: '-2%', md: '-7%' },
            borderRadius: '50%',
            bgcolor: 'transparent',
            filter: 'blur(46px) saturate(1.6)',
            opacity: 0.55,
            zIndex: 0,
          }}
        />
      )}
      <Artwork
        src={artwork}
        alt={track.albumName || track.title}
        iconSize={72}
        sx={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          aspectRatio: '1 / 1',
          borderRadius: 3,
          boxShadow: 10,
        }}
      />
      {player.buffering && (
        <CircularProgress
          size={44}
          sx={{
            position: 'absolute',
            inset: 0,
            margin: 'auto',
            zIndex: 2,
            color: accentFg,
          }}
        />
      )}
    </Box>
  );

  const titleBlock = (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{ mt: { xs: 2, md: 1 }, textAlign: { xs: 'center', md: 'left' } }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent={{ xs: 'center', md: 'flex-start' }}
          spacing={0.75}
        >
          <Typography variant="h6" noWrap>
            {track.title}
          </Typography>
          {track.isExplicit && (
            <ExplicitIcon
              aria-label="Explicit"
              sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }}
            />
          )}
        </Stack>
        <Typography
          variant="body2"
          color="text.secondary"
          noWrap
          role={track.artist ? 'link' : undefined}
          tabIndex={track.artist ? 0 : undefined}
          onClick={searchArtist}
          onKeyDown={(event) => {
            if (event.key === 'Enter') searchArtist();
          }}
          sx={{
            cursor: track.artist ? 'pointer' : 'default',
            '&:hover': { color: accentFg },
          }}
        >
          {track.artist}
        </Typography>
        {track.albumName && (
          <Typography
            variant="caption"
            color="text.disabled"
            noWrap
            sx={{ display: 'block', mt: 0.25 }}
          >
            {track.albumName}
          </Typography>
        )}
      </Box>
    </Stack>
  );

  const errorAlert = player.error ? (
    <Alert
      severity="error"
      onClose={player.dismissError}
      sx={{ mt: 1.5, py: 0 }}
      action={
        <Button
          color="inherit"
          size="small"
          startIcon={<RefreshIcon fontSize="small" />}
          onClick={retry}
        >
          Retry
        </Button>
      }
    >
      {player.error}
    </Alert>
  ) : null;

  /**
   * Secondary row. On a phone it also carries the three panel shortcuts
   * (lyrics / queue / related) — on a desktop those live in the tabs to the
   * right, so only the heart and the download stay here.
   */
  const secondaryRow = (
    <Stack direction="row" alignItems="center" justifyContent="center" spacing={0.5} sx={{ mt: 1 }}>
      {!isDesktop && (
        <>
          <Tooltip title="Lyrics" placement="top">
            <IconButton aria-label="Show lyrics" onClick={() => openPanel(LYRICS_TAB)}>
              <LyricsIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Queue" placement="top">
            <IconButton aria-label="Show queue" onClick={() => openPanel(QUEUE_TAB)}>
              <QueueMusicIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Related" placement="top">
            <IconButton aria-label="Show related songs" onClick={() => openPanel(RELATED_TAB)}>
              <RelatedIcon />
            </IconButton>
          </Tooltip>
        </>
      )}
      <NPFavorite track={track} />
      <DownloadButton
        track={track}
        meta={meta}
        waitForCache={() => player.waitForCache(track.videoId)}
      />
    </Stack>
  );

  const scrubber = (
    <NPScrubber
      currentTime={player.currentTime}
      duration={duration}
      buffered={player.buffered}
      onSeek={player.seek}
    />
  );

  /** Lyrics / queue / related, shared by the phone panel and the desktop column. */
  const panel = (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <Tabs
        value={tab}
        onChange={onTabChange}
        variant="fullWidth"
        aria-label="Now playing panels"
        sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}
      >
        <Tab
          disableRipple
          value={LYRICS_TAB}
          label="Lyrics"
          icon={<LyricsIcon />}
          iconPosition="start"
          sx={TAB_SX}
        />
        <Tab
          disableRipple
          value={QUEUE_TAB}
          label="Queue"
          icon={<QueueMusicIcon />}
          iconPosition="start"
          sx={TAB_SX}
        />
        <Tab
          disableRipple
          value={RELATED_TAB}
          label="Related"
          icon={<RelatedIcon />}
          iconPosition="start"
          sx={TAB_SX}
        />
      </Tabs>
      <Box sx={{ flex: 1, minHeight: 220, position: 'relative', mt: 1 }}>
        {/* Lyrics mounts only while its tab is open: it measures real layout
            to centre the active line, which a display:none box cannot do. */}
        {tab === LYRICS_TAB && (
          <Box sx={{ height: '100%' }}>
            <LyricsView
              synced={lyrics.synced}
              unsynced={lyrics.unsynced}
              source={lyrics.source}
              loading={meta === null}
            />
          </Box>
        )}
        {/* Queue and related stay mounted (hidden) so switching tabs never
            resets their scroll position or flickers a loading state. */}
        <Box sx={{ display: tab === QUEUE_TAB ? 'block' : 'none', height: '100%' }}>
          <NPQueue />
        </Box>
        <Box sx={{ display: tab === RELATED_TAB ? 'block' : 'none', height: '100%' }}>
          <RelatedTab />
        </Box>
      </Box>
    </Box>
  );

  const backdrop = effectsEnabled ? (
    <Box
      aria-hidden
      sx={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}
    >
      {artwork && (
        <Artwork
          src={artwork}
          alt=""
          icon={null}
          sx={{
            position: 'absolute',
            top: '-25%',
            left: '-25%',
            width: '150%',
            height: '150%',
          }}
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
  ) : null;

  // ── Phone: main view (artwork → info → controls → secondary row) ───────
  const mobileMain = (
    <Box
      sx={{
        position: 'relative',
        zIndex: 1,
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        px: 3,
        pt: 0.5,
        pb: 2,
        // on a short screen the column scrolls instead of clipping
        overflowY: 'auto',
      }}
    >
      {artworkBox}
      {titleBlock}
      {errorAlert}
      {scrubber}
      <NPControls />
      {secondaryRow}
    </Box>
  );

  // ── Phone: a panel has taken the screen over ───────────────────────────
  const mobilePanel = (
    <Box
      sx={{
        position: 'relative',
        zIndex: 1,
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        px: 2,
        pt: 1,
        pb: 1,
      }}
    >
      {/* compact now-playing card: the song stays visible above the panel,
          and the down arrow folds everything back to the main view */}
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.5}
        sx={{
          px: 1.25,
          py: 1,
          mb: 0.5,
          bgcolor: 'background.paper',
          border: 1,
          borderColor: 'divider',
          borderRadius: 2,
          flexShrink: 0,
        }}
      >
        <Artwork
          src={artwork}
          alt=""
          iconSize={20}
          sx={{ width: 44, height: 44, borderRadius: 1.5, flexShrink: 0 }}
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
          aria-label="Back to player"
          onClick={() => setPanelOpen(false)}
          sx={{ border: 1, borderColor: 'divider' }}
        >
          <ExpandMoreIcon />
        </IconButton>
      </Stack>
      {panel}
    </Box>
  );

  // ── Desktop: centred two-column dialog ─────────────────────────────────
  const desktopBody = (
    <Box
      sx={{
        position: 'relative',
        zIndex: 1,
        flex: 1,
        minHeight: 0,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 0.9fr) minmax(0, 1.1fr)',
        columnGap: 4,
        rowGap: 2,
        px: { md: 4 },
        pb: 3,
        // the columns handle their own overflow — the glow may bleed into
        // the gap, but nothing ever escapes the dialog itself
        overflow: 'hidden',
      }}
    >
      {/* ── Left: cover + ambient glow, centred in its column ───────── */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 0,
          minWidth: 0,
          py: 2,
        }}
      >
        {artworkBox}
      </Box>

      {/* ── Right: info → scrubber → transport → panels ─────────────── */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          minWidth: 0,
          overflowY: 'auto',
          pr: 0.5,
        }}
      >
        {titleBlock}
        {errorAlert}
        {scrubber}
        <NPControls />
        {secondaryRow}
        <Box sx={{ flex: 1, minHeight: 240, display: 'flex', flexDirection: 'column', mt: 1.5 }}>
          {panel}
        </Box>
      </Box>
    </Box>
  );

  const showHeader = isDesktop || !panelOpen;

  return (
    <Dialog
      fullScreen={!isDesktop}
      open={player.sheetOpen}
      onClose={handleClose}
      TransitionComponent={isDesktop ? undefined : SheetTransition}
      aria-label="Now playing"
      PaperProps={{
        sx: {
          overflow: 'hidden',
          bgcolor: 'background.default',
          // desktop: a centred modal that can never outgrow its window
          width: { md: 'min(1120px, calc(100vw - 64px))' },
          height: { md: 'min(760px, calc(100vh - 64px))' },
          maxWidth: { md: '100%' },
        },
      }}
    >
      <Box
        ref={sheetRef}
        sx={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
        }}
      >
        {backdrop}
        {!isDesktop && strip}
        {showHeader && header}
        {isDesktop ? desktopBody : panelOpen ? mobilePanel : mobileMain}
      </Box>
    </Dialog>
  );
}
