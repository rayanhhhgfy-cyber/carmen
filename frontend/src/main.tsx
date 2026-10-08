import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { loadAppState, type NavigationState, NAVIGATION_KEY } from './db/repos/appState';
import { hydrateLocalLibrary } from './offline/source';
import { bootstrapPlatform } from './platform/env';
import { hydrateSettings } from './settings/store';
import { hydrateLibrary } from './utils/library';
import './fonts';

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
  await Promise.allSettled([hydrateSettings(), hydrateLibrary(), hydrateLocalLibrary()]);
  await restoreRoute();

  const container = document.getElementById('root');
  if (!container) throw new Error('#root missing from index.html');
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
