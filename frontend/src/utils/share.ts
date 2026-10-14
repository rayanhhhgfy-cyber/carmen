import type { Track } from '../types/models';
import { isTauri } from '../platform/env';
import { notify } from './downloadsStore';

/**
 * Sharing a song through Carmen.
 *
 * A link crawler (Telegram, Discord, WhatsApp) never runs the JS router, so
 * the shared URL carries the target in the **query string** —
 * `https://host/?song=xyz` — which the server renders an Open Graph preview
 * from (see `server/share.py`). On load the SPA folds the same query back
 * into the `#/song/xyz` hash route (see `main.tsx`), so the link plays the
 * song for humans too.
 *
 * Sharing **always copies the link** — no system share sheet. A copied URL
 * pastes anywhere (a chat, an email, a status) and behaves identically for
 * everyone, while `navigator.share` on iOS hijacks the tap into a sheet the
 * user did not ask for here.
 */

/**
 * The public web origin. The Tauri WebView's own origin (`tauri://localhost`)
 * is meaningless to a link crawler and to a human pasting it, so shares from
 * the installed app always point at the hosted site instead.
 */
const WEB_ORIGIN = 'https://carmen.z44d.com';

/** Absolute shareable link of one song. */
export function songShareUrl(videoId: string): string {
  const { origin, pathname } = window.location;
  const base = isTauri ? `${WEB_ORIGIN}${pathname}` : `${origin}${pathname}`;
  return `${base}?song=${encodeURIComponent(videoId)}`;
}

/**
 * The hash route a share URL points at, or `null`.
 *
 * Two shapes reach the app:
 *
 *  - the **web** form `https://host/?song=xyz` — the query string a crawler
 *    renders (see `server/share.py`), which the SPA folds into the hash
 *    router on load (see `main.tsx`);
 *  - the **deep-linked** form the installed app receives on Android: the
 *    same https URL through an App Link, or `carmen://song/xyz` through the
 *    fallback custom scheme (registered in `tauri.conf.json`, no server
 *    verification needed — see DEVELOPMENT.md).
 */
export function shareTarget(raw: string | URL): string | null {
  let url: URL;
  try {
    url = typeof raw === 'string' ? new URL(raw, window.location.href) : raw;
  } catch {
    return null;
  }

  const song = url.searchParams.get('song');
  if (song) return `/song/${encodeURIComponent(song)}`;
  const searchQuery = url.searchParams.get('search');
  if (searchQuery) return `/search?query=${encodeURIComponent(searchQuery)}`;
  const playlist = url.searchParams.get('playlist');
  if (playlist) return `/collection/playlist/${encodeURIComponent(playlist)}`;

  // Path form — `carmen://song/xyz` parses as host "song" + path "/xyz",
  // and the same segments work for an https path if the web ever links it.
  const segments = `${url.host}${url.pathname}`.split('/').filter(Boolean);
  if (segments[0] === 'song' && segments[1]) {
    return `/song/${encodeURIComponent(segments[1])}`;
  }
  if (segments[0] === 'collection' && segments[1] === 'playlist' && segments[2]) {
    return `/collection/playlist/${encodeURIComponent(segments[2])}`;
  }
  return null;
}

/**
 * Copy the share link of a song to the clipboard and report the outcome
 * through the app's snackbar, so the result is never silent.
 */
export async function shareTrack(track: Pick<Track, 'videoId' | 'title' | 'artist'>): Promise<void> {
  const url = songShareUrl(track.videoId);

  try {
    await navigator.clipboard.writeText(url);
    notify('success', 'Link copied to clipboard');
  } catch {
    // `clipboard.writeText` needs a secure context and can be refused by
    // the platform — fall back to the legacy copy path before giving up.
    try {
      const field = document.createElement('textarea');
      field.value = url;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      const copied = document.execCommand('copy');
      field.remove();
      notify(copied ? 'success' : 'error', copied ? 'Link copied to clipboard' : 'Could not copy the link');
    } catch {
      notify('error', 'Could not copy the link');
    }
  }
}
