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
 */

/** Absolute shareable link of one song. */
export function songShareUrl(videoId: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}?song=${encodeURIComponent(videoId)}`;
}

/**
 * Share a song: the system share sheet where the platform offers one
 * (`navigator.share`), the clipboard everywhere else. Both paths report
 * through the app's snackbar, so the outcome is never silent.
 */
export async function shareTrack(track: Pick<Track, 'videoId' | 'title' | 'artist'>): Promise<void> {
  const url = songShareUrl(track.videoId);
  const title = track.artist && track.artist !== 'Unknown artist'
    ? `${track.title} — ${track.artist}`
    : track.title;

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, url });
      return;
    } catch (error) {
      // A cancelled share sheet is the user's choice and stays silent;
      // anything else (no share target, permissions) falls back to copy.
      if ((error as Error)?.name === 'AbortError') return;
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    notify('success', 'Link copied to clipboard');
  } catch {
    notify('error', 'Could not copy the link');
  }
}
