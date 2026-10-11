import type { Track } from '../types/models';
import { notify } from './downloads';

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

/** Absolute shareable link of one song. */
export function songShareUrl(videoId: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}?song=${encodeURIComponent(videoId)}`;
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
