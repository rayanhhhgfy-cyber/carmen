/**
 * Platform detection — the one place the app asks "where is it running?".
 *
 * `platform/env.ts` stays the single source of truth for the raw flags (it is
 * also the Tauri IPC bridge); this module is the `services/`-layer facade the
 * browser/PWA work reads from, extended with the Apple-mobile fact that the
 * lock-screen artwork pipeline needs. Nothing here allocates or listens —
 * every value is a module-load constant.
 */
import { isDesktop, isTauri } from '../platform/env';

export { isDesktop, isTauri };

/** True in any plain browser session (vite dev, deployed web, iOS Safari, PWA). */
export const isBrowser: boolean = !isTauri;

/**
 * iPhone / iPad / iPod Safari — including iPadOS, which masquerades as
 * `Macintosh` in its user agent and only tells the truth through
 * `maxTouchPoints`.
 *
 * This is the gate of everything iOS-lock-screen: the animated artwork
 * pipeline (`services/mediaSession/lockScreenArtwork`) runs nowhere else.
 */
export const isIOS: boolean =
  typeof navigator !== 'undefined' &&
  (/iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ claims to be a Mac; a real Mac has no touch points.
    (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1));
