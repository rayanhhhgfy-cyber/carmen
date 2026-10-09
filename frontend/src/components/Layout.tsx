import { useSyncExternalStore } from 'react';
import type { ComponentType } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { useIsDesktop } from '../hooks';
import { usePlayer } from '../player/PlayerContext';
import { useArtworkBackground, useEffectsEnabled } from '../settings/store';
import { useTheme as useAppTheme } from '../theme/ThemeContext';
import { clearNotice, getDownloadsSnapshot, subscribeDownloads } from '../utils/downloads';
import { cn } from '../utils/cn';
import AmbientBackground from './AmbientBackground';
import MiniPlayer from './MiniPlayer';
import PlayerSheet from './PlayerSheet';
import type { SvgIconProps } from './SvgIcon';
import { Alert, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Snackbar } from './ui';
import {
  DarkModeIcon,
  HomeIcon,
  LibraryIcon,
  LightModeIcon,
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

function SideNav() {
  const location = useLocation();
  // Glass only while the ambient tint can bleed through: low battery
  // mode paints the solid paper colour instead (no backdrop-filter).
  const effectsEnabled = useEffectsEnabled();
  const { resolved } = useAppTheme();
  return (
    <aside
      className="w-[216px] shrink-0 border-r border-line"
      style={{
        boxSizing: 'border-box',
        backgroundColor: !effectsEnabled
          ? 'var(--app-paper)'
          : resolved === 'dark'
            ? 'rgba(18,23,20,0.86)'
            : 'rgba(255,255,255,0.86)',
        backdropFilter: effectsEnabled ? 'blur(16px)' : 'none',
      }}
    >
      <div className="flex min-h-14 items-center gap-2 px-5">
        <span
          className="grid h-7 w-7 place-items-center bg-accent text-accent-fg"
          style={{ borderRadius: 21, fontWeight: 800, fontSize: 15 }}
        >
          C
        </span>
        <h6 className={TITLE_CLS}>Carmen</h6>
      </div>
      <List className="px-3">
        {NAV_ITEMS.map(({ label, path, icon: Icon }) => (
          <ListItemButton
            key={path}
            as={NavLink}
            to={path}
            selected={location.pathname === path}
            className="mb-1"
          >
            <ListItemIcon sx={{ minWidth: 38, color: 'inherit' }}>
              <Icon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary={label} />
          </ListItemButton>
        ))}
      </List>
    </aside>
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

  return (
    <div className="flex min-h-screen">
      {/* artwork driven ambient tint (painted behind every surface) —
          low battery mode and the Settings choice skip it entirely */}
      {effectsEnabled && artworkBackground && <AmbientBackground />}

      {isDesktop && <SideNav />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-[1100] border-b border-line"
          style={{
            backdropFilter: effectsEnabled ? 'blur(12px)' : 'none',
            backgroundColor: !effectsEnabled
              ? 'var(--app-bg)'
              : appTheme.resolved === 'dark'
                ? 'rgba(10,13,11,0.72)'
                : 'rgba(246,247,246,0.78)',
          }}
        >
          <div className="flex min-h-14 items-center px-4 md:min-h-16">
            {isDesktop ? (
              <h6 className={TITLE_CLS}>
                {NAV_ITEMS.find((item) => item.path === location.pathname)?.label || 'Carmen'}
              </h6>
            ) : (
              <h6 className={`${TITLE_CLS} flex-1`}>Carmen</h6>
            )}
            <div className="flex-1" />
            <IconButton
              aria-label={
                appTheme.resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
              }
              onClick={() => appTheme.setMode(appTheme.resolved === 'dark' ? 'light' : 'dark')}
            >
              {appTheme.resolved === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
          </div>
        </header>

        <main className="flex-1" style={{ paddingBottom: contentPaddingBottom }}>
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
    </div>
  );
}
