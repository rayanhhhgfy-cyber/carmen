import {
  Alert,
  AppBar,
  Box,
  BottomNavigation,
  BottomNavigationAction,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Snackbar,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import SearchIcon from '@mui/icons-material/Search';
import QueueMusicIcon from '@mui/icons-material/QueueMusic';
import SettingsIcon from '@mui/icons-material/Settings';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import { useSyncExternalStore } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { usePlayer } from '../player/PlayerContext';
import { useTheme as useAppTheme } from '../theme/ThemeContext';
import { clearNotice, getDownloadsSnapshot, subscribeDownloads } from '../utils/downloads';
import AmbientBackground from './AmbientBackground';
import MiniPlayer from './MiniPlayer';
import PlayerSheet from './PlayerSheet';

const NAV_ITEMS = [
  { label: 'Home', path: '/', icon: HomeIcon },
  { label: 'Search', path: '/search', icon: SearchIcon },
  { label: 'Queue', path: '/queue', icon: QueueMusicIcon },
  { label: 'Settings', path: '/settings', icon: SettingsIcon },
];

function SideNav() {
  const location = useLocation();
  return (
    <Drawer
      variant="permanent"
      sx={{
        width: 216,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: 216,
          boxSizing: 'border-box',
          borderRight: 1,
          borderColor: 'divider',
          // translucent so the ambient artwork tint bleeds through
          bgcolor: (theme) =>
            theme.palette.mode === 'dark' ? 'rgba(18,23,20,0.86)' : 'rgba(255,255,255,0.86)',
          backdropFilter: 'blur(16px)',
        },
      }}
    >
      <Toolbar sx={{ px: 2.5, gap: 1 }}>
        <Box
          sx={{
            width: 28,
            height: 28,
            borderRadius: 1.5,
            bgcolor: 'primary.main',
            display: 'grid',
            placeItems: 'center',
            color: 'primary.contrastText',
            fontWeight: 800,
            fontSize: 15,
          }}
        >
          S
        </Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
          Samma3ni
        </Typography>
      </Toolbar>
      <List sx={{ px: 1.5 }}>
        {NAV_ITEMS.map(({ label, path, icon: Icon }) => (
          <ListItemButton
            key={path}
            component={NavLink}
            to={path}
            selected={location.pathname === path}
            sx={{ mb: 0.5 }}
          >
            <ListItemIcon sx={{ minWidth: 38, color: 'inherit' }}>
              <Icon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary={label} primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }} />
          </ListItemButton>
        ))}
      </List>
    </Drawer>
  );
}

function NoticeSnackbars() {
  const { notice } = useSyncExternalStore(subscribeDownloads, getDownloadsSnapshot);
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
        <Alert severity={notice?.severity || 'info'} variant="filled" onClose={clearNotice} sx={{ width: '100%' }}>
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
  const muiTheme = useTheme();
  const player = usePlayer();
  const location = useLocation();
  const navigate = useNavigate();
  const isDesktop = useMediaQuery(muiTheme.breakpoints.up('md'));
  const showMini = Boolean(player.current);

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
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* artwork driven ambient tint (painted behind every surface) */}
      <AmbientBackground />

      {isDesktop && <SideNav />}

      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <AppBar
          position="sticky"
          color="transparent"
          elevation={0}
          enableColorOnDark
          sx={{
            backdropFilter: 'blur(12px)',
            bgcolor: (theme) =>
              theme.palette.mode === 'dark'
                ? 'rgba(10,13,11,0.72)'
                : 'rgba(246,247,246,0.78)',
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Toolbar sx={{ minHeight: { xs: 56, md: 64 } }}>
            {isDesktop ? (
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                {NAV_ITEMS.find((item) => item.path === location.pathname)?.label || 'Samma3ni'}
              </Typography>
            ) : (
              <Typography variant="h6" sx={{ fontWeight: 800, flex: 1 }}>
                Samma3ni
              </Typography>
            )}
            <Box sx={{ flex: 1 }} />
            <IconButton
              aria-label={
                appTheme.resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
              }
              onClick={() => appTheme.setMode(appTheme.resolved === 'dark' ? 'light' : 'dark')}
            >
              {appTheme.resolved === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
          </Toolbar>
        </AppBar>

        <Box component="main" sx={{ flex: 1, pb: contentPaddingBottom }}>
          <Outlet />
        </Box>
      </Box>

      {/* the docked bar would sit under the desktop player drawer, so it
          steps aside while the player is open */}
      {!(isDesktop && player.sheetOpen) && <MiniPlayer bottomOffset={bottomOffset} />}

      {!isDesktop && (
        <BottomNavigation
          showLabels
          value={location.pathname}
          onChange={(_, newPath) => navigate(newPath)}
          sx={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            height: `calc(${navHeight}px + env(safe-area-inset-bottom))`,
            pb: 'env(safe-area-inset-bottom)',
            borderTop: 1,
            borderColor: 'divider',
            bgcolor: (theme) =>
              theme.palette.mode === 'dark' ? 'rgba(18,23,20,0.9)' : 'rgba(255,255,255,0.9)',
            backdropFilter: 'blur(16px)',
            zIndex: (theme) => theme.zIndex.appBar,
          }}
        >
          {NAV_ITEMS.map(({ label, path, icon: Icon }) => (
            <BottomNavigationAction
              key={path}
              value={path}
              label={label}
              icon={<Icon />}
              sx={{ color: location.pathname === path ? 'primary.main' : 'text.secondary' }}
            />
          ))}
        </BottomNavigation>
      )}

      <PlayerSheet />
      <NoticeSnackbars />
    </Box>
  );
}
