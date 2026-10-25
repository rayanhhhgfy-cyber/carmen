import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { loadAppState, type NavigationState, NAVIGATION_KEY } from './db/repos/appState';
import { favoriteIds } from './db/repos/favorites';
import { hydrateFlags } from './db/flags';
import { hydrateLocalLibrary, downloadedVideoIds } from './offline/source';
import { bootstrapPlatform, isTauri } from './platform/env';
import { startDeepLinkListener } from './platform/deepLink';
import { startBatteryTracking } from './settings/battery';
import { hydrateSettings } from './settings/store';
import { ensurePersistentStorage, hydrateBrowserStorage } from './services/storage';
import { initPwaInstall } from './services/pwaInstall';
import { hydrateLibrary } from './utils/library';
import { shareTarget } from './utils/share';
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
/**
 * Fold a shared link's query string into the hash route.
 *
 * A shared song/search/playlist link is `https://host/?song=xyz` — the query
 * string is the part a crawler fetches (it renders the Open Graph preview,
 * see `server/share.py`). Once the SPA takes over, the same target has to
 * live in the hash router, so rewrite the address to `#/song/xyz` *before*
 * React mounts. The leftover query is dropped: from here on the hash route
 * is the single source of truth (RoutePersistence saves it too).
 *
 * A real deep link already in the hash always wins and is left untouched.
 * (Inside the installed Android app the same resolution happens through
 * `platform/deepLink.ts` — the OS hands the URL to the plugin, not to the
 * address bar.)
 */
function foldShareRoute(): void {
  const { hash, pathname, search } = window.location;
  if (hash && hash !== '#' && hash !== '#/') return;
  if (!search || search === '?') return;

  const target = shareTarget(window.location.href);
  if (!target) return;

  window.history.replaceState(null, '', `${pathname}#${target}`);
}

async function restoreRoute(): Promise<void> {
  foldShareRoute();
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
    // Tauri: sweep week-old songs out of `<app data>/.cache` and index what
    // is left, before the first track can play (no-op in the browser).
    import('./utils/streamCache').then((m) => m.initStreamCache()),
  ]);
  // Downloaded / favorited flags feed the badges + "already saved" state of
  // every row, so they are seeded before the first render too.
  try {
    const [downloaded, favorites] = await Promise.all([downloadedVideoIds(), favoriteIds()]);
    hydrateFlags(downloaded, favorites);
  } catch {
    /* badges simply start empty */
  }
  // Downloaded songs only stay offline if the browser keeps the storage:
  // IndexedDB is evictable "best-effort" until the origin is persisted,
  // so ask for persistence up front whenever there is anything to lose.
  if (downloadedVideoIds().length > 0) {
    void ensurePersistentStorage();
  }
  // Smart downloads (opt-in, `services/smartDownloads.ts`): liked songs +
  // favourite playlists through the existing download pipeline, gated on
  // the connection type. Runs here at launch — after the catalogue and
  // flags are hydrated, so already-downloaded tracks are skipped — and
  // the watcher below re-runs it whenever a favourite is added. Both are
  // fire-and-forget: a failure here must never block first paint. (This
  // is the only boot hook; App/Layout/PlayerContext are untouched.)
  void import('./services/smartDownloads')
    .then((m) => {
      m.startSmartDownloadsWatcher();
      return m.runSmartDownloadsFromApp();
    })
    .catch(() => {});
  await restoreRoute();
  // Android: the app may have been launched by tapping a shared link —
  // resolve it over the restored route (no-op in a browser).
  startDeepLinkListener();
  // Repair older downloads that were saved without an album — fire and forget.
  void import('./utils/downloads').then((m) => m.backfillAlbumNames()).catch(() => {});

  // Web only: register the service worker that precaches the app shell,
  // so the installed app opens with no connection. Tauri bundles the
  // shell locally and has no service-worker origin, so it skips this.
  // Fire-and-forget and failure-proof: if registration fails, the app
  // simply behaves like before (online-only) and still paints.
  if (!isTauri) {
    // Capture the one-shot install prompt early — a listener mounted
    // later (e.g. in Settings) would miss an event that already fired.
    initPwaInstall();
    void import('virtual:pwa-register')
      .then((m) => m.registerSW({ immediate: true }))
      .catch(() => {});
  }

  const container = document.getElementById('root');
  if (!container) throw new Error('#root missing from index.html');
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
