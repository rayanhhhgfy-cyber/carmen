/**
 * Which source is actually playing, for the player indicator.
 *
 * The `<audio>` element only knows a URL, and `AudioSource.kind` alone
 * cannot tell the two servers apart (both are `'stream'`) or Audius
 * from iTunes (both are `'external'`). This module is the single place
 * that maps an `AudioSource` to the short label the UI shows — the
 * player context sets its `playbackSource` state from it everywhere it
 * sets `sourceRef`, and the badge components only ever read that state,
 * so the label can never disagree with what the element is playing.
 *
 * Labels are friendly names, never raw URLs or hostnames: the demo
 * server is the "Relay Server", any other stream host is the user's own
 * configured server ("Carmen Server" — the Render `carmen-api` or a
 * Settings override), a local file is "Downloaded", and the Spotify
 * repo's legal fallbacks keep their own names.
 */

import type { AudioSource } from '../offline/source';
import type { ExternalStreamSource } from '../services/spotifySources';

/** Every source the indicator can name; `null` (in the context) = idle. */
export type PlaybackSourceId =
  | 'downloaded'
  | 'carmen'
  | 'relay'
  | 'audius'
  | 'itunes';

/** The exact words the badge shows for each source. */
export const PLAYBACK_SOURCE_LABELS: Record<PlaybackSourceId, string> = {
  downloaded: 'Downloaded',
  carmen: 'Carmen Server',
  relay: 'Relay Server',
  audius: 'Audius',
  itunes: 'iTunes Preview',
};

/** Host of the demo/relay server (see `api.ts`: `streamFallbackUrl`). */
export const DEMO_RELAY_HOST = 'api-carmen-v1.syr.qzz.io';

/**
 * Which server a `/stream` URL belongs to: the demo host is the relay,
 * anything else is the user's own Carmen server (Render `carmen-api`, or
 * whatever base the Settings override / `VITE_STREAM_BASE` points at).
 * An unparseable URL is treated as the user's own server, never the relay.
 */
export function playbackSourceForStreamUrl(url: string): PlaybackSourceId {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'carmen';
  }
  if (host === DEMO_RELAY_HOST) return 'relay';
  return 'carmen';
}

/** Which legal source supplied an external stream, from its URL. */
function externalSourceForUrl(url: string): ExternalStreamSource {
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  if (host.includes('itunes.apple.com')) return 'itunes';
  return 'audius';
}

/**
 * The indicator id for the source the element is on, or `null` when
 * there is no source. Asset/blob (downloaded file, stream cache) are
 * local, so both read "Downloaded" — the cache file is the song on the
 * device, not a server.
 */
export function playbackSourceForAudioSource(
  source: AudioSource | null,
): PlaybackSourceId | null {
  if (!source) return null;
  switch (source.kind) {
    case 'asset':
    case 'blob':
      return 'downloaded';
    case 'stream':
      return playbackSourceForStreamUrl(source.url);
    case 'external':
      return source.externalSource ?? externalSourceForUrl(source.url);
  }
}
