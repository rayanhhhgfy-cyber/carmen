import { shareTarget } from '../utils/share';
import { isTauri } from './env';

/**
 * Opening the installed app from a shared link (Android **App Links** plus
 * the `carmen://` fallback scheme, through `tauri-plugin-deep-link`).
 *
 * On Android the OS hands the tapped https URL to the app instead of the
 * browser once the association verifies (`frontend/public/.well-known/
 * assetlinks.json` — see DEVELOPMENT.md). The webview never loads that URL;
 * the plugin exposes it here, and the target rides the very same hash route
 * the web client folds from the query string (`foldShareRoute` in
 * `main.tsx`), so `?song=xyz` plays the song in both worlds.
 */

/** Navigate to the share target of one deep-linked URL, if it has one. */
export function applyDeepLink(url: string): void {
  const target = shareTarget(url);
  if (!target) return;
  const next = `#${target}`;
  if (window.location.hash !== next) window.location.hash = next;
}

/**
 * Start listening for deep links — a no-op outside Tauri, where the share
 * query string is folded by the SPA itself and no OS delivers links here.
 *
 * Both delivery moments are covered: the link the app was **launched**
 * with (`getCurrent`, before React matters) and the links tapped while it
 * is already running (`onOpenUrl`).
 */
export function startDeepLinkListener(): void {
  if (!isTauri) return;
  void import('@tauri-apps/plugin-deep-link')
    .then(async ({ getCurrent, onOpenUrl }) => {
      await onOpenUrl((urls) => {
        for (const url of urls) applyDeepLink(url);
      });
      const launched = await getCurrent();
      for (const url of launched ?? []) applyDeepLink(url);
    })
    .catch(() => {
      /* plugin unavailable in this build — web behaviour unchanged */
    });
}
