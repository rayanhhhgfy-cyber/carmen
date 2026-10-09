import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { loadAppState, type NavigationState, NAVIGATION_KEY } from './db/repos/appState';
import { favoriteIds } from './db/repos/favorites';
import { hydrateFlags } from './db/flags';
import { hydrateLocalLibrary, downloadedVideoIds } from './offline/source';
import { bootstrapPlatform } from './platform/env';
import { startBatteryTracking } from './settings/battery';
import { hydrateSettings } from './settings/store';
import { hydrateBrowserStorage } from './services/storage';
import { hydrateLibrary } from './utils/library';
import './fonts';
import './styles.css';

/**
 * Native-app context menu: right-click does nothing outside editable fields,
 * where the paste / cut / copy menu is still genuinely useful.  No view in
 * the app renders a custom context menu, so the webview's default one is
 * pure desktop artifact.
 */
document.addEventListener('contextmenu', (event) => {
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (!target?.closest('input, textarea, [contenteditable="true"], [contenteditable=""]')) {
    event.preventDefault();
  }
});

/**
 * Bootstrap runs **before** the first render so the app never paints with the
 * default theme, an empty feed or a lost route:
 *
 *   1. Tauri platform info (storage paths),
 *   2. SQLite settings (theme + lyrics provider) with legacy migration,
 *   3. home feed + offline download catalogue,
 *   4. route restore — the exact page saved before the last close.
 */
async function restoreRoute(): Promise<void> {
  const current = window.location.hash;
  if (current && current !== '#' && current !== '#/') return; // deep link wins
  try {
    const saved = await loadAppState<NavigationState>(NAVIGATION_KEY, {
      pathname: '/',
      search: '',
    });
    if (saved?.pathname && saved.pathname !== '/') {
      window.location.hash = `#${saved.pathname}${saved.search ?? ''}`;
    }
  } catch {
    /* start on the default page */
  }
}

async function bootstrap(): Promise<void> {
  await bootstrapPlatform();
  // Browser sessions: fill the IndexedDB-backed KV cache (and migrate the
  // legacy localStorage shims) *before* any repository reads settings,
  // playlists or the resume point. No-op inside Tauri.
  await hydrateBrowserStorage();
  await Promise.allSettled([
    hydrateSettings(),
    hydrateLibrary(),
    hydrateLocalLibrary(),
    // Battery reading for the low-battery auto mode — a device without one
    // simply keeps the mode manual (settings/battery.ts).
    startBatteryTracking(),
  ]);
  // Downloaded / favorited flags feed the badges + "already saved" state of
  // every row, so they are seeded before the first render too.
  try {
    const [downloaded, favorites] = await Promise.all([downloadedVideoIds(), favoriteIds()]);
    hydrateFlags(downloaded, favorites);
  } catch {
    /* badges simply start empty */
  }
  await restoreRoute();
  // Repair older downloads that were saved without an album — fire and forget.
  void import('./utils/downloads').then((m) => m.backfillAlbumNames()).catch(() => {});

  const container = document.getElementById('root');
  if (!container) throw new Error('#root missing from index.html');
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
