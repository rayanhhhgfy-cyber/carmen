import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { ComponentType } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { useIsDesktop } from '../hooks';
import { usePlayer } from '../player/PlayerContext';
import SmartDownloadWatcher from '../offline/smartDownload';
import { useArtworkBackground, useEffectsEnabled } from '../settings/store';
import { useTheme as useAppTheme } from '../theme/ThemeContext';
import { clearNotice, getDownloadsSnapshot, subscribeDownloads } from '../utils/downloadsStore';
import { alpha } from '../utils/color';
import { cn } from '../utils/cn';
import AmbientBackground from './AmbientBackground';
import MiniPlayer from './MiniPlayer';
import PlayerSheet from './PlayerSheet';
import type { SvgIconProps } from './SvgIcon';
import { Alert, Snackbar } from './ui';
import {
  HomeIcon,
  LibraryIcon,
  QueueListIcon,
  SearchIcon,
  SettingsIcon,
} from './icons';

/** One entry of the primary navigation (side drawer and bottom bar). */
interface NavItem {
  label: string;
  path: string;
  icon: ComponentType<SvgIconProps>;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Home', path: '/', icon: HomeIcon },
  { label: 'Search', path: '/search', icon: SearchIcon },
  { label: 'Queue', path: '/queue', icon: QueueListIcon },
  { label: 'Library', path: '/library', icon: LibraryIcon },
  { label: 'Settings', path: '/settings', icon: SettingsIcon },
];

/** Section-title typography (MUI h6: 1.25rem/1.6/700, tightened tracking). */
const TITLE_CLS = 'm-0 text-xl font-extrabold leading-[1.6] tracking-[-0.02em]';

/** The app logo (green tile + note), served from `frontend/public/`. */
const LOGO_SRC = `${import.meta.env.BASE_URL}logo.png`;

/**
 * Desktop navigation: a compact floating card pinned to the left edge and
 * centred vertically (`fixed left-4 top-1/2 -translate-y-1/2`). Icons only
 * by default — hovering an individual tab expands *that row* to reveal its
 * label (`max-w-0 → max-w-[120px]`, `transition-all duration-300`) and the
 * card grows with it; leaving collapses it again.
 *
 * Color logic: the active tab wears the app accent — via `text-accent`, so
 * it is the *adaptive* accent whenever that setting is on (`--app-accent`
 * tracks the playing artwork) — plus a soft accent glow; hovering an
 * inactive tab colours icon and label with the same accent. Glass follows
 * the same effect switch as every other surface — low battery mode paints
 * solid paper, no blur.
 */
function FloatingNav() {
  const location = useLocation();
  // Glass only while the ambient tint can bleed through: low battery
  // mode paints the solid paper colour instead (no backdrop-filter).
  const effectsEnabled = useEffectsEnabled();
  const { resolved, accentInUse } = useAppTheme();
  // A white accent painted straight onto the light card would be white on
  // white — the same fallback the bottom bar uses further down.
  const whiteOnLight = resolved === 'light' && accentInUse.toLowerCase() === '#ffffff';
  return (
    <nav
      aria-label="Primary"
      className={cn(
        'fixed left-4 top-1/2 z-[1200] flex w-fit max-w-[236px] -translate-y-1/2 flex-col gap-1',
        'rounded-2xl border border-line p-2',
      )}
      style={{
        backgroundColor: !effectsEnabled
          ? 'var(--app-paper)'
          : resolved === 'dark'
            ? 'rgba(18,23,20,0.86)'
            : 'rgba(255,255,255,0.86)',
        backdropFilter: effectsEnabled ? 'blur(16px)' : 'none',
        WebkitBackdropFilter: effectsEnabled ? 'blur(16px)' : 'none',
        boxShadow: effectsEnabled ? 'var(--shadow-glass)' : 'none',
      }}
    >
      {NAV_ITEMS.map(({ label, path, icon: Icon }) => {
        const active = location.pathname === path;
        return (
          <NavLink
            key={path}
            to={path}
            title={label}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group flex items-center gap-3 rounded-xl p-3 no-underline',
              'transition-all duration-300 ease-out',
              'focus-visible:outline-2 focus-visible:outline-accent',
              // `text-accent` resolves through `--app-accent`, which the
              // theme context keeps pointing at the *effective* accent —
              // stored or adaptive — so the highlight repaints the moment
              // the artwork color changes.
              active
                ? whiteOnLight
                  ? 'bg-hover text-body'
                  : 'bg-accent/10 text-accent'
                : 'text-muted hover:bg-hover hover:text-accent',
            )}
            style={
              active && effectsEnabled && !whiteOnLight
                ? { boxShadow: `0 0 18px ${alpha('var(--app-accent)', 0.3)}` }
                : undefined
            }
          >
            <Icon className="shrink-0" />
            {/* label reveal: 0 → 120px on row hover, hidden again on leave */}
            <span
              className={cn(
                'max-w-0 overflow-hidden whitespace-nowrap text-sm font-semibold',
                'opacity-0 transition-all duration-300 group-hover:max-w-[120px] group-hover:opacity-100',
              )}
            >
              {label}
            </span>
          </NavLink>
        );
      })}
    </nav>
  );
}

function NoticeSnackbars() {
  const { notice } = useSyncExternalStore(subscribeDownloads, getDownloadsSnapshot, getDownloadsSnapshot);
  const player = usePlayer();

  return (
    <>
      <Snackbar
        key={notice?.id}
        open={Boolean(notice)}
        autoHideDuration={4000}
        onClose={clearNotice}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={notice?.severity || 'info'} variant="filled" onClose={clearNotice} className="w-full">
          {notice?.message}
        </Alert>
      </Snackbar>

      <Snackbar
        open={Boolean(player.error) && !player.sheetOpen}
        autoHideDuration={6000}
        onClose={player.dismissError}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert severity="error" variant="filled" onClose={player.dismissError}>
          {player.error}
        </Alert>
      </Snackbar>
    </>
  );
}

/** App shell: navigation, docked mini player, full player and snackbars. */
export default function Layout() {
  const appTheme = useAppTheme();
  const player = usePlayer();
  const location = useLocation();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const showMini = Boolean(player.current);
  // Low battery mode: no ambient artwork layer, no glass surfaces —
  // plain solid ones instead (see useEffectsEnabled). The ambient wash
  // additionally has its own Settings choice (artwork background).
  const effectsEnabled = useEffectsEnabled();
  const artworkBackground = useArtworkBackground();
  // A white accent painted straight onto the light bar would be white on
  // white, so the selected label falls back to the plain text colour there.
  const whiteAccentOnLightBar =
    appTheme.resolved === 'light' && appTheme.accentInUse.toLowerCase() === '#ffffff';

  const navHeight = 56;
  const bottomOffset = isDesktop
    ? showMini
      ? 'calc(env(safe-area-inset-bottom) + 16px)'
      : '0px'
    : `calc(${navHeight}px + env(safe-area-inset-bottom) + ${showMini ? 12 : 6}px)`;

  const contentPaddingBottom = isDesktop
    ? `calc(${showMini ? 92 : 24}px + env(safe-area-inset-bottom))`
    : `calc(${navHeight}px + env(safe-area-inset-bottom) + ${showMini ? 84 : 20}px)`;

  // Every navigation starts at the top. `<main>` is the app's only scroller,
  // so it keeps its position across routes — without this, opening Queue,
  // Search or Settings landed wherever Home was left scrolled. Query-only
  // changes (a new search term on the same page) deliberately keep the
  // position: the view itself never changed.
  const scrollerRef = useRef<HTMLElement | null>(null);
  const lastPathname = useRef(location.pathname);
  useEffect(() => {
    if (lastPathname.current === location.pathname) return;
    lastPathname.current = location.pathname;
    scrollerRef.current?.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    // Fixed-height app window: the root never scrolls (styles.css locks
    // html/body/#root), only `<main>` below does — no rubber-banding, no
    // horizontal document overflow, header and nav pinned by the column.
    <div className="flex h-dvh overflow-hidden">
      {/* artwork driven ambient tint (painted behind every surface) —
          low battery mode and the Settings choice skip it entirely */}
      {effectsEnabled && artworkBackground && <AmbientBackground />}

      {isDesktop && <FloatingNav />}

      {/* md+: the floating nav card sits over the left edge, so the whole
          content column (header included) clears it with a left inset —
          everything else stays full-bleed below the breakpoint */}
      <div className="flex min-w-0 flex-1 flex-col md:pl-[84px]">
        {/* pinned by the flex column, not by `sticky`: the scroll starts at
            `<main>` below, so the header can never scroll away */}
        <header
          className="relative z-[1100] border-b border-line"
          style={{
            // Status-bar clearance, owned here (and nowhere else) so the
            // header's wash paints *under* the status bar instead of
            // leaving a bare band above it. `--sat` is 0px wherever the
            // window is not edge-to-edge, so desktop/iOS are untouched.
            paddingTop: 'var(--sat)',
            backdropFilter: effectsEnabled ? 'blur(12px)' : 'none',
            backgroundColor: !effectsEnabled
              ? 'var(--app-bg)'
              : appTheme.resolved === 'dark'
                ? 'rgba(10,13,11,0.72)'
                : 'rgba(246,247,246,0.78)',
          }}
        >
          <div className="flex min-h-14 items-center gap-2.5 px-4 md:min-h-16">
            <img
              src={LOGO_SRC}
              alt=""
              aria-hidden="true"
              draggable={false}
              className="h-7 w-7 shrink-0 rounded-[9px] md:h-8 md:w-8 md:rounded-[10px]"
            />
            <h6 className={TITLE_CLS}>
              {isDesktop
                ? NAV_ITEMS.find((item) => item.path === location.pathname)?.label || 'Carmen'
                : 'Carmen'}
            </h6>
          </div>
        </header>

        {/* the app's single vertical scroller — pages lay out inside it;
            `id="app-main"` lets HomePage's pull-to-refresh read its position */}
        <main
          id="app-main"
          ref={scrollerRef}
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
          style={{ paddingBottom: contentPaddingBottom }}
        >
          <Outlet />
        </main>
      </div>

      {/* the docked bar would sit under the desktop player drawer, so it
          steps aside while the player is open */}
      {!(isDesktop && player.sheetOpen) && <MiniPlayer bottomOffset={bottomOffset} />}

      {!isDesktop && (
        <nav
          className="fixed inset-x-0 bottom-0 z-[1100] flex"
          style={{
            height: `calc(${navHeight}px + env(safe-area-inset-bottom))`,
            paddingBottom: 'env(safe-area-inset-bottom)',
            borderTop: '1px solid var(--app-divider)',
            backgroundColor: !effectsEnabled
              ? 'var(--app-paper)'
              : appTheme.resolved === 'dark'
                ? 'rgba(18,23,20,0.9)'
                : 'rgba(255,255,255,0.9)',
            backdropFilter: effectsEnabled ? 'blur(16px)' : 'none',
          }}
        >
          {NAV_ITEMS.map(({ label, path, icon: Icon }) => (
            <button
              key={path}
              type="button"
              onClick={() => navigate(path)}
              className={cn(
                'flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1',
                'text-xs font-medium transition-colors',
                'focus-visible:outline-2 focus-visible:outline-accent',
                location.pathname === path
                  ? whiteAccentOnLightBar
                    ? 'text-body'
                    : 'text-accent'
                  : 'text-muted',
              )}
            >
              <Icon />
              <span className="max-w-full truncate">{label}</span>
            </button>
          ))}
        </nav>
      )}

      <PlayerSheet />
      <NoticeSnackbars />
      {/* paint-less playhead watcher for the smart-downloads rule — kept as
          its own leaf so the shell never re-renders on playback ticks */}
      <SmartDownloadWatcher />
    </div>
  );
}
