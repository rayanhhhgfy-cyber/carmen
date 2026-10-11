import Artwork from "./Artwork";
import DownloadButton from "./DownloadButton";
import LyricsView from "./LyricsView";
import MarqueeText from "./MarqueeText";
import NPControls from "./NPControls";
import NPFavorite from "./NPFavorite";
import NPQueue from "./NPQueue";
import NPScrubber from "./NPScrubber";
import PlayerMenu from "./PlayerMenu";
import RelatedTab from "./RelatedTab";
import { useNavigate } from "react-router-dom";
import { useIsDesktop } from "../hooks";
import { usePlayer } from "../player/PlayerContext";
import { useEffectsEnabled } from "../settings/store";
import { useTheme as useAppTheme } from "../theme/ThemeContext";
import { cn } from "../utils/cn";
import { alpha } from "../utils/color";
import { lyricsOf } from "../utils/lyrics";
import { pickArtwork } from "../utils/track";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type TouchEvent,
} from 'react';
import {
  Alert,
  Button,
  Dialog,
  IconButton,
  Spinner,
  Tab,
  Tabs,
} from '../components/ui';

import {
  CloseIcon,
  ExpandMoreIcon,
  ExplicitIcon,
  FullScreenIcon,
  ExitFullScreenIcon,
  LyricsIcon,
  QueueMusicIcon,
  RelatedIcon,
  RefreshIcon,
} from './icons';

import { useMotionArtwork } from '../artwork/motion';
import { useVideoPowerGuard } from '../artwork/useVideoPowerGuard';
import { isTauri } from '../platform/env';
import { useAnimatedArtwork } from '../settings/store';

/** Tab order inside the player: 0 lyrics · 1 queue · 2 related. */
const LYRICS_TAB = 0;
const QUEUE_TAB = 1;
const RELATED_TAB = 2;

/** Pixels of downward swipe on the handle that dismiss the sheet. */
const DISMISS_DISTANCE = 72;


/**
 * Shared metrics of the three tabs (the old `TAB_SX`): 50px tall, no
 * minimum width so they can share the strip, semibold label — the kit Tab
 * already renders without `text-transform`.
 */
const TAB_CLASS = 'min-h-[50px] min-w-0 !font-semibold';

/**
 * The full "Now Playing" experience, in two shapes switched at the `md`
 * breakpoint:
 *
 * * **Phone** — a full-screen sheet over the window. A grab *handle* sits on
 *   the top edge: tap it or swipe it down to dismiss (the sheet follows the
 *   finger while the swipe is in flight). Below it: artwork,
 *   title / artist / album, scrubber, transport, and the
 *   secondary row — lyrics · queue · related · favorite · download — all of
 *   it inside thumb reach. The three panels take the screen over from a
 *   compact now-playing card when one of those buttons is tapped.
 * * **Desktop / tablet** — a *centred* modal sized inside the window
 *   (`min(1120px, 100vw − 64px)` × `min(760px, 100vh − 64px)`), split into
 *   two columns: the cover on the left, and
 *   info → scrubber → transport → lyrics / queue / related on the right.
 *   The sheet itself never scrolls on either axis — only the lyrics /
 *   queue / related lists do, inside their own boxes — so a stray gesture
 *   near the scrubber thumb can never move the page under the finger.
 *
 * Mounting is unchanged: `Layout` renders this once and the player
 * context's `sheetOpen` / `setSheetOpen` drive the open/close mechanics.
 */
export default function PlayerSheet() {
  const player = usePlayer();
  // Line art on the sheet surface (focus ring, spinner, artist hover) needs
  // the readable accent — white on a light sheet would be invisible. It
  // reaches the CSS through the `accent-fg` token now; `resolved` picks the
  // theme-coloured scrim over the motion loops.
  const { resolved } = useAppTheme();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  // The blurred artwork layer (the wash behind the sheet) is the expensive
  // part of this screen — low battery mode
  // drops it and keeps the plain surfaces.
  const effectsEnabled = useEffectsEnabled();

  const [tab, setTab] = useState<number>(LYRICS_TAB);
  /** Phone only: a panel (lyrics / queue / related) has taken the screen. */
  const [panelOpen, setPanelOpen] = useState(false);

  const track = player.current;
  const meta = player.meta;
  const videoId = track?.videoId;

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

  // A fresh open always starts at zero. Usually the node is brand new, but
  // if the sheet is reopened while its slide-down exit is still running the
  // old node survives — and with it the last drag's offset.
  useEffect(() => {
    if (!player.sheetOpen) return;
    const node = sheetRef.current;
    if (!node) return;
    node.style.transition = 'none';
    node.style.transform = '';
    node.style.opacity = '';
  }, [player.sheetOpen]);

  // The system/browser Back closes the sheet instead of navigating the page
  // away underneath it. Opening pushes a history entry (same URL, so the
  // router never notices); Back pops it and we close. Dismissing any other
  // way consumes that entry so the next Back still navigates normally.
  const dismissedByBack = useRef(false);
  useEffect(() => {
    if (!player.sheetOpen) return undefined;
    window.history.pushState({ ...window.history.state, carmenSheet: true }, '');
    const onPopState = () => {
      dismissedByBack.current = true;
      setPanelOpen(false);
      setTab(LYRICS_TAB);
      player.setSheetOpen(false);
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      // A Back-triggered close already popped our entry (so `history.state`
      // no longer carries `carmenSheet`); a UI close has not — drop it here.
      if (!dismissedByBack.current && window.history.state?.carmenSheet) {
        window.history.back();
      }
      dismissedByBack.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.sheetOpen]);

  // ── Full screen (desktop card) ──────────────────────────────────────────
  // The now-playing card can be blown up to fill the whole display. On
  // desktop this expands the card *and* puts the window (Tauri) or the
  // document (browser) into real full screen; on a phone the sheet already
  // covers everything, so the control never appears there.
  const [fullScreen, setFullScreen] = useState(false);

  // Browser Esc / system exit keeps the toggle honest.
  useEffect(() => {
    const onFullScreenChange = () => setFullScreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullScreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullScreenChange);
  }, []);

  // Closing the sheet drops any full-screen mode with it.
  useEffect(() => {
    if (player.sheetOpen || !fullScreen) return;
    setFullScreen(false);
    if (isTauri) {
      void import('@tauri-apps/api/window')
        .then((win) => win.getCurrentWindow().setFullscreen(false))
        .catch(() => {});
    } else if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
  }, [player.sheetOpen, fullScreen]);

  const toggleFullScreen = async () => {
    const next = !fullScreen;
    setFullScreen(next);
    try {
      if (isTauri) {
        const win = await import('@tauri-apps/api/window');
        await win.getCurrentWindow().setFullscreen(next);
      } else if (next) {
        await document.documentElement.requestFullscreen?.();
      } else {
        await document.exitFullscreen?.();
      }
    } catch {
      /* full screen is best-effort — the card still expands via the CSS below */
    }
  };

  const lyrics = useMemo(() => lyricsOf(meta), [meta]);

  // The album's YouTube Music browse id — the key the server fallback uses to
  // resolve an iTunes collection id when the client's own search is blocked.
  const metaAlbumId =
    meta && typeof meta.album === 'object' && meta.album ? meta.album.id ?? null : null;

  // Animated cover identity for this track — the sheet resolves it once
  // (memoised in `artwork/motion`) and renders it as the video layers
  // below: the whole card on desktop, only the lyrics page on a phone.
  // Now Playing is the only screen that animates; every cover tile and
  // grid stays static (Apple Music does the same).
  const motionRef = track
    ? {
        album: track.albumName,
        albumId: track.album?.id || metaAlbumId,
        videoId: track.videoId,
        title: track.title,
        artist: track.artist,
      }
    : null;
  const animatedArtwork = useAnimatedArtwork();
  // Resolves only while the sheet is open: listening without looking at the
  // player costs no catalogue calls at all.
  const motionUrl = useMotionArtwork(motionRef, animatedArtwork && player.sheetOpen);
  const [motionReady, setMotionReady] = useState(false);
  useEffect(() => {
    setMotionReady(false);
  }, [motionUrl]);
  // The loops are decorative — when nobody can see them they must not cost
  // a single decoded frame. The guard pauses each element on minimize,
  // hide, focus loss or scroll-out and resumes it only when every signal
  // allows again (see artwork/useVideoPowerGuard).
  const cardVideoRef = useRef<HTMLVideoElement | null>(null);
  const panelVideoRef = useRef<HTMLVideoElement | null>(null);
  useVideoPowerGuard(cardVideoRef, Boolean(motionUrl));
  useVideoPowerGuard(panelVideoRef, Boolean(motionUrl));
  // Readability scrim shared by both motion layers — theme-coloured so the
  // light mode sheet stays light and the dark one stays dark.
  const motionScrim =
    resolved === 'dark'
      ? 'linear-gradient(180deg, rgba(10,13,11,0.48) 0%, rgba(10,13,11,0.72) 100%)'
      : 'linear-gradient(180deg, rgba(246,247,246,0.62) 0%, rgba(246,247,246,0.82) 100%)';

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

  // MIGRATION: the kit Tabs calls `onChange(value)` — no MUI event argument.
  const onTabChange = (value: unknown) => setTab(value as number);

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
   * Retry plays through the context: it re-points the element at the
   * current song's best source (downloaded file, then stream) and keeps the
   * fallback chain's record of what the element plays in sync, so a retry
   * that itself fails still walks the full chain and reports the real
   * error.
   */
  const retry = () => player.retry();

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
    dragStartY.current = null;
    dragDistance.current = 0;
    if (distance > DISMISS_DISTANCE) {
      // Keep the dragged offset in place: the Dialog's slide-down exit now
      // takes the sheet out from wherever the finger let go instead of
      // springing back up first. The node unmounts with the exit, so the
      // next open starts clean.
      handleClose();
      return;
    }
    if (node) {
      node.style.transition = 'transform 240ms cubic-bezier(.2,.8,.2,1), opacity 240ms ease';
      node.style.transform = '';
      node.style.opacity = '';
    }
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
    <div
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
      className="relative z-[2] grid shrink-0 cursor-pointer place-items-center touch-none pb-1 pt-[10px] focus-visible:rounded-[28px] focus-visible:[outline:2px_solid_var(--app-accent-fg)] focus-visible:[outline-offset:-2px]"
    >
      <div aria-hidden className="h-1 w-11 rounded-[56px] bg-disabled" />
    </div>
  );

  const header = (
    <div className="relative z-[2] flex shrink-0 flex-row items-center gap-2 px-[10px] py-[6px]">
      <IconButton edge="start" aria-label="Close player" onClick={handleClose}>
        {isDesktop ? <CloseIcon /> : <ExpandMoreIcon />}
      </IconButton>
      {/* Phone: the centred eyebrow a full-screen player expects — pinned
          out of flow so the close/menu buttons never shift. */}
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[11px] font-bold uppercase leading-[1.4] tracking-[0.16em] text-muted md:hidden">
        Now playing
      </span>
      <div className="flex-1" />
      {isDesktop && (
        <IconButton
          aria-label={fullScreen ? 'Exit full screen' : 'Full screen'}
          onClick={() => {
            void toggleFullScreen();
          }}
        >
          {fullScreen ? <ExitFullScreenIcon /> : <FullScreenIcon />}
        </IconButton>
      )}
      <PlayerMenu track={track} meta={meta} />
    </div>
  );

  /**
   * The cover — a sharp, square thumbnail centred in its column. The
   * blurred circular halo that used to bleed out from behind it is gone;
   * the sheet's backdrop (and, on desktop, the motion loop) carries the
   * colour instead.
   */
  const artworkBox = (
    <div className="relative mx-auto w-full max-w-[min(86vw,392px,44vh)] sm:max-w-[min(60vw,340px)] md:max-w-[min(100%,440px)]">
      <Artwork
        src={artwork}
        alt={track.albumName || track.title}
        iconSize={72}
        style={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          aspectRatio: '1 / 1',
          borderRadius: 42,
          boxShadow: 'var(--shadow-elev-10)',
        }}
      />
      {player.buffering && (
        <Spinner
          size={44}
          color="inherit"
          className="absolute inset-0 z-[2] m-auto text-accent-fg"
        />
      )}
    </div>
  );

  /**
   * Title · explicit badge · artist · album — the metadata both layouts
   * share; only the title's weight differs (hero `h5` on the phone, the
   * `h6` that has always sat beside the desktop columns). The `md:`
   * alignment rule is safe in the shared markup because the desktop body
   * only ever renders at ≥900px.
   */
  const titleMeta = (titleVariant: 'h5' | 'h6') => (
    <>
      <div className="flex flex-row items-center justify-center gap-[6px] md:justify-start">
        <MarqueeText text={track.title} variant={titleVariant} />
        {track.isExplicit && (
          <ExplicitIcon
            aria-label="Explicit"
            sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }}
          />
        )}
      </div>
      <p
        className={cn(
          'm-0 truncate text-sm leading-[1.43] text-muted hover:text-accent-fg',
          track.artist ? 'cursor-pointer' : 'cursor-default',
        )}
        role={track.artist ? 'link' : undefined}
        tabIndex={track.artist ? 0 : undefined}
        onClick={searchArtist}
        onKeyDown={(event) => {
          if (event.key === 'Enter') searchArtist();
        }}
      >
        {track.artist}
      </p>
      {track.albumName && (
        <span className="mt-[2px] block truncate text-xs leading-[1.4] text-disabled">
          {track.albumName}
        </span>
      )}
    </>
  );

  const titleBlock = (
    <div className="mt-4 flex flex-row items-center gap-2 text-center md:mt-2 md:text-left">
      <div className="min-w-0 flex-1">{titleMeta('h6')}</div>
    </div>
  );

  /**
   * Phone arrangement: the hero title with the heart riding its right
   * edge — Apple Music's placement, so the favourite is a thumb away from
   * the thing it favourites instead of hiding in the row below.
   */
  const mobileTitleBlock = (
    <div className="mt-5 flex items-center gap-1 text-center">
      <div className="min-w-0 flex-1">{titleMeta('h5')}</div>
      <NPFavorite track={track} />
    </div>
  );

  const errorAlert = player.error ? (
    <Alert severity="error" onClose={player.dismissError} className="mt-3 !py-0">
      {/* MIGRATION: the kit Alert has no `action` slot, and the kit Button
          has no `size="small"` / `color="inherit"` — the Retry button rides
          inside the message row with those metrics written as classes. */}
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">{player.error}</span>
        <Button
          startIcon={<RefreshIcon fontSize="small" />}
          onClick={retry}
          className="shrink-0 !px-2 !py-1 !text-[0.8125rem] !text-white hover:!bg-white/10"
        >
          Retry
        </Button>
      </div>
    </Alert>
  ) : null;

  /**
   * Secondary row (desktop): the heart and the download, under the
   * transport. On a phone those two live elsewhere now — the heart rides
   * the title, the download sits in the labelled action bar — so this row
   * stops carrying the bare panel icons that used to live here.
   */
  const secondaryRow = (
    <div className="mt-2 flex flex-row items-center justify-center gap-1">
      <NPFavorite track={track} />
      <DownloadButton
        track={track}
        meta={meta}
        waitForCache={() => player.waitForCache(track.videoId)}
      />
    </div>
  );

  /**
   * Phone action bar: one segmented glass pill under the transport —
   * three labelled panel destinations (the bare icons they replaced were
   * far too quiet) and the download cell at the end, everything within a
   * thumb's arc.
   */
  const mobileActionBar = (
    <div className="mx-auto mt-4 flex w-full max-w-[440px] items-stretch overflow-hidden rounded-full border border-line bg-surface/60 backdrop-blur-xl">
      {[
        { label: 'Lyrics', Icon: LyricsIcon, tab: LYRICS_TAB },
        { label: 'Queue', Icon: QueueMusicIcon, tab: QUEUE_TAB },
        { label: 'Related', Icon: RelatedIcon, tab: RELATED_TAB },
      ].map(({ label, Icon, tab: value }) => (
        <button
          key={label}
          type="button"
          onClick={() => openPanel(value)}
          className={cn(
            'flex min-w-0 flex-1 items-center justify-center gap-1.5 px-2 py-3',
            'text-xs font-semibold text-muted',
            'transition-colors duration-150 hover:bg-hover hover:text-body active:scale-[0.98]',
            'focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2',
          )}
        >
          <Icon fontSize="small" className="shrink-0" />
          <span className="truncate">{label}</span>
        </button>
      ))}
      <div className="grid w-14 shrink-0 place-items-center border-l border-line">
        <DownloadButton
          track={track}
          meta={meta}
          waitForCache={() => player.waitForCache(track.videoId)}
        />
      </div>
    </div>
  );

  const scrubber = <NPScrubber onSeek={player.seek} />;

  /** Lyrics / queue / related, shared by the phone panel and the desktop column. */
  const panel = (
    <div className="flex min-h-0 flex-1 flex-col">
      <Tabs
        value={tab}
        onChange={onTabChange}
        variant="fullWidth"
        aria-label="Now playing panels"
        className="shrink-0 border-b border-line"
      >
        <Tab
          value={LYRICS_TAB}
          label="Lyrics"
          icon={<LyricsIcon />}
          iconPosition="start"
          className={TAB_CLASS}
        />
        <Tab
          value={QUEUE_TAB}
          label="Queue"
          icon={<QueueMusicIcon />}
          iconPosition="start"
          className={TAB_CLASS}
        />
        <Tab
          value={RELATED_TAB}
          label="Related"
          icon={<RelatedIcon />}
          iconPosition="start"
          className={TAB_CLASS}
        />
      </Tabs>
      <div className="relative mt-2 min-h-[220px] flex-1 overflow-hidden rounded-[28px]">
        {/* Phone only: the animated cover, fitted edge-to-edge behind the
            lyrics under a theme-coloured scrim, so every line stays
            readable on top of moving pixels. A phone animates nowhere else
            — on desktop the whole card carries the loop instead, and queue
            and related keep the plain surface. */}
        {tab === LYRICS_TAB && motionUrl && !isDesktop && (
          <>
            <video
              ref={panelVideoRef}
              src={motionUrl}
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
              onCanPlay={() => setMotionReady(true)}
              onError={() => setMotionReady(false)}
              aria-hidden
              className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover"
              style={{ opacity: motionReady ? 1 : 0, transition: 'opacity 400ms ease' }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-[1]"
              style={{
                background: motionScrim,
                opacity: motionReady ? 1 : 0,
                transition: 'opacity 400ms ease',
              }}
            />
          </>
        )}
        {/* Lyrics mounts only while its tab is open: it measures real layout
            to centre the active line, which a display:none box cannot do. */}
        {tab === LYRICS_TAB && (
          <div className="relative z-[2] h-full">
            <LyricsView
              synced={lyrics.synced}
              unsynced={lyrics.unsynced}
              source={lyrics.source}
              loading={meta === null}
            />
          </div>
        )}
        {/* Queue and related stay mounted (hidden) so switching tabs never
            resets their scroll position or flickers a loading state. */}
        <div className={cn('h-full', tab === QUEUE_TAB ? 'block' : 'hidden')}>
          <NPQueue />
        </div>
        <div className={cn('h-full', tab === RELATED_TAB ? 'block' : 'hidden')}>
          <RelatedTab />
        </div>
      </div>
    </div>
  );

  const backdrop = effectsEnabled ? (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {artwork && (
        <Artwork
          src={artwork}
          alt=""
          icon={null}
          style={{
            position: 'absolute',
            top: '-25%',
            left: '-25%',
            width: '150%',
            height: '150%',
          }}
          imgStyle={{ filter: 'blur(70px) saturate(1.5)', opacity: 0.55 }}
        />
      )}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(180deg, ${alpha('var(--app-bg)', 0.5)} 0%, ${alpha('var(--app-bg)', 0.88)} 45%, var(--app-bg) 100%)`,
        }}
      />
    </div>
  ) : null;

  // ── Phone: main view (cover → hero info → scrubber → transport → bar) ──
  const mobileMain = (
    // the column never scrolls: a stray scroll or swipe while reaching for
    // the scrubber thumb used to move the whole page under the finger.
    // `overflow-y-auto` alone also computes `overflow-x` to `auto`, which
    // is what let the sheet pan sideways — both axes are locked now. The
    // layout is sized to fit (the cover caps itself at 44vh), so on a
    // short screen the bottom simply clips instead of scrolling; the
    // bottom padding clears the home indicator where the OS reports one
    <div className="relative z-[1] flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-1">
      {artworkBox}
      {mobileTitleBlock}
      {errorAlert}
      {scrubber}
      <NPControls phone />
      {mobileActionBar}
    </div>
  );

  // ── Phone: a panel has taken the screen over ───────────────────────────
  const mobilePanel = (
    <div className="relative z-[1] flex min-h-0 flex-1 flex-col px-4 py-2">
      {/* compact now-playing card: the song stays visible above the panel,
          and the down arrow folds everything back to the main view */}
      <div className="mb-1 flex shrink-0 flex-row items-center gap-3 rounded-[28px] border border-line bg-surface px-[10px] py-2">
        <Artwork
          src={artwork}
          alt=""
          iconSize={20}
          style={{ width: 44, height: 44, borderRadius: 21, flexShrink: 0 }}
        />
        <div className="min-w-0 flex-1">
          <MarqueeText text={track.title} variant="subtitle2" />
          <span className="block truncate text-xs leading-[1.4] text-muted">
            {track.artist}
          </span>
        </div>
        <IconButton
          aria-label="Back to player"
          onClick={() => setPanelOpen(false)}
          className="border border-line"
        >
          <ExpandMoreIcon />
        </IconButton>
      </div>
      {panel}
    </div>
  );

  // ── Desktop: centred two-column dialog ─────────────────────────────────
  const desktopBody = (
    // the columns handle their own overflow — nothing ever escapes the
    // dialog itself
    <div className="relative z-[1] grid min-h-0 flex-1 grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-x-8 gap-y-4 overflow-hidden pb-6 md:px-8">
      {/* ── Left: cover, centred in its column ─────────────────────── */}
      <div className="flex min-h-0 min-w-0 items-center justify-center py-4">
        {artworkBox}
      </div>

      {/* ── Right: info → scrubber → transport → panels ─────────────── */}
      {/* no scrolling on the column itself (neither axis): gestures aimed
          at the scrubber thumb must never move the page. Only the
          lyrics / queue / related lists scroll, inside their own boxes */}
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden pr-1">
        {titleBlock}
        {errorAlert}
        {scrubber}
        <NPControls />
        {secondaryRow}
        <div className="mt-3 flex min-h-[240px] flex-1 flex-col">
          {panel}
        </div>
      </div>
    </div>
  );

  const showHeader = isDesktop || !panelOpen;

  // MIGRATION: `fullScreen` / `TransitionComponent` / `PaperProps` have no
  // kit equivalents — the kit Dialog animates the layer itself (a short
  // fade-and-rise instead of the old bottom `Slide`), and the paper's shape
  // lives in `className`: window-filling below `md`, the centred
  // `min(1120px, 100vw − 64px)` × `min(760px, 100vh − 64px)` card above.
  return (
    <Dialog
      open={player.sheetOpen}
      onClose={handleClose}
      aria-label="Now playing"
      // Phone: the sheet now *leaves downward* on close (matching the drag
      // that usually dismisses it); the desktop card keeps the shared fade.
      slideFromBottom={!isDesktop}
      className={cn(
        // `shrink-0` is what makes the phone sheet truly edge-to-edge: the
        // dialog wrapper is a padded flexbox, and a `w-screen` item would
        // otherwise shrink into its padding, leaving a dim strip of the page
        // showing through on both sides.
        '!h-screen !w-screen !max-h-none !max-w-none !rounded-none !bg-bg shrink-0',
        // Desktop sizes the card down to a panel — unless full screen is on,
        // where it takes the whole viewport (same as the phone sheet).
        !fullScreen &&
          'md:!h-[min(760px,calc(100vh_-_64px))] md:!w-[min(1120px,calc(100vw_-_64px))] md:!rounded-card',
      )}
    >
      <div
        ref={sheetRef}
        className="relative flex h-full min-h-0 flex-col"
      >
        {backdrop}
        {/* Desktop: the motion cover spans the whole Now Playing card —
            one fitted video under the shared scrim, painted above the
            backdrop but below every piece of content (the body and header
            carry their own z-index). The static cover tile and the controls
            sit on top of it; on a phone this layer never mounts — there the
            loop plays only behind the lyrics panel. */}
        {isDesktop && motionUrl && (
          <>
            <video
              ref={cardVideoRef}
              src={motionUrl}
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
              onCanPlay={() => setMotionReady(true)}
              onError={() => setMotionReady(false)}
              aria-hidden
              className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover"
              style={{ opacity: motionReady ? 1 : 0, transition: 'opacity 400ms ease' }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-[1]"
              style={{
                background: motionScrim,
                opacity: motionReady ? 1 : 0,
                transition: 'opacity 400ms ease',
              }}
            />
          </>
        )}
        {!isDesktop && strip}
        {showHeader && header}
        {isDesktop ? desktopBody : panelOpen ? mobilePanel : mobileMain}
      </div>
    </Dialog>
  );
}
