/**
 * Fallback song sources, ported from the Spotify-clone repo
 * (`rayanhhhgfy-cyber/spotify`, `src/api.ts`: `formatAudiusSong`,
 * `formatITunesSong`, `resolveFullLengthStream`).
 *
 * FALLBACK ONLY. Carmen's own chain always runs first — downloaded file,
 * then the primary server stream, then the other server's stream (see
 * `PlayerContext.handleError`). This module is only consulted after every
 * Carmen source has failed, and only to keep a song playing instead of
 * showing an error.
 *
 * What is ported, and what is deliberately NOT ported:
 *   - Audius (full-length streams, legal): the discovery-node search, the
 *     title-match check, and the stream-mirror list. Ported as-is.
 *   - iTunes (30-second previews, legal): the search lookup and its
 *     `previewUrl`. Ported as-is — a preview is better than silence, but
 *     it is only ever the last resort after Audius.
 *   - The Spotify repo's step 1 (its own `/api/resolve` YouTube resolver)
 *     is NOT ported: Carmen has no such endpoint, and no YouTube
 *     extraction is added or changed here.
 *
 * No keys, no secrets, no new dependencies. Both hosts are public,
 * CORS-enabled search/stream APIs.
 */

/** Audius discovery nodes, in the order the Spotify repo tries them. */
export const AUDIUS_DISCOVERY_NODES = [
  'https://api.audius.co',
  'https://discoveryprovider.audius.co',
  'https://discoveryprovider2.audius.co',
] as const;

/** Audius wants an application name on every request. */
const AUDIUS_APP_NAME = 'SPOTIFY_CLONE';

/** Give up on one slow host instead of stalling the player on it. */
const FETCH_TIMEOUT_MS = 5000;

export type ExternalStreamSource = 'audius' | 'itunes';

export interface ExternalStream {
  /** Direct audio URL the `<audio>` element can play. */
  audioUrl: string;
  /** Same track on other hosts, best first (Audius only; iTunes has one). */
  mirrors: string[];
  /** Track length in ms, or null when the source did not say. */
  durationMs: number | null;
  /** Which legal source supplied the stream. */
  source: ExternalStreamSource;
}

type FetchFn = typeof fetch;

/** Fetch JSON with a timeout; network errors and non-2xx are null. */
async function fetchJson(
  url: string,
  fetcher: FetchFn,
): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetcher(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Spotify's title normaliser: letters/digits only, lower-cased. */
function cleanTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * An Audius search hit, shaped the way the Spotify repo's
 * `formatAudiusSong` reads it: the stream URL, its mirrors, and a
 * duration. Returns null when the hit has nothing playable.
 */
function formatAudiusTrack(record: any): Omit<ExternalStream, 'source'> | null {
  const trackId = record?.id ?? (record?.track_id ? String(record.track_id) : '');
  const mirrors: string[] = [];
  if (record?.stream?.url) {
    mirrors.push(record.stream.url);
    if (Array.isArray(record.stream.mirrors)) {
      const pathAndQuery = String(record.stream.url).replace(/^https?:\/\/[^/]+/, '');
      for (const mirror of record.stream.mirrors) {
        if (mirror) mirrors.push(`${mirror}${pathAndQuery}`);
      }
    }
  }
  if (trackId) {
    mirrors.push(
      `https://api.audius.co/v1/tracks/${trackId}/stream?app_name=${AUDIUS_APP_NAME}`,
      `https://discoveryprovider.audius.co/v1/tracks/${trackId}/stream?app_name=${AUDIUS_APP_NAME}`,
    );
  }
  const uniqueMirrors = [...new Set(mirrors.filter(Boolean))];
  const audioUrl =
    uniqueMirrors[0] ??
    (trackId
      ? `https://api.audius.co/v1/tracks/${trackId}/stream?app_name=${AUDIUS_APP_NAME}`
      : '');
  if (!audioUrl) return null;
  const durationMs =
    typeof record?.duration === 'number' && record.duration > 0
      ? record.duration * 1000
      : null;
  return { audioUrl, mirrors: uniqueMirrors, durationMs };
}

/** An iTunes search hit: the preview URL is the whole stream. */
function formatITunesTrack(record: any): Omit<ExternalStream, 'source'> | null {
  if (!record?.previewUrl) return null;
  return {
    audioUrl: record.previewUrl,
    mirrors: [record.previewUrl],
    durationMs:
      typeof record?.trackTimeMillis === 'number' ? record.trackTimeMillis : null,
  };
}

/**
 * Audius step: search each discovery node for the title (+ artist), and
 * take the first hit whose title matches and which has a stream. A title
 * with no Latin letters/digits (e.g. Arabic) cannot be title-matched, so
 * the search query itself is the filter there and the first streamable
 * hit wins.
 */
async function resolveFromAudius(
  title: string,
  artist: string,
  fetcher: FetchFn,
): Promise<ExternalStream | null> {
  const wanted = cleanTitle(title);
  const queries = [`${title} ${artist}`.trim(), title.trim()].filter(Boolean);
  for (const query of queries) {
    for (const node of AUDIUS_DISCOVERY_NODES) {
      const data = await fetchJson(
        `${node}/v1/tracks/search?query=${encodeURIComponent(query)}&app_name=${AUDIUS_APP_NAME}`,
        fetcher,
      );
      const hits = data?.data;
      if (!Array.isArray(hits) || !hits.length) continue;
      const match = hits.find((hit: any) => {
        if (!hit?.title) return false;
        const hasStream =
          hit.stream?.url || hit.stream_url || hit.is_streamable || hit.id;
        if (!hasStream) return false;
        if (!wanted) return true;
        const hitTitle = cleanTitle(String(hit.title));
        return hitTitle.includes(wanted) || wanted.includes(hitTitle);
      });
      if (!match) continue;
      const formatted = formatAudiusTrack(match);
      if (formatted) return { ...formatted, source: 'audius' };
    }
  }
  return null;
}

/** iTunes step: first search hit with a preview URL (30 seconds). */
async function resolveFromITunes(
  title: string,
  artist: string,
  fetcher: FetchFn,
): Promise<ExternalStream | null> {
  const data = await fetchJson(
    `https://itunes.apple.com/search?term=${encodeURIComponent(`${title} ${artist}`.trim())}&entity=song&limit=1`,
    fetcher,
  );
  const hit = data?.results?.[0];
  if (!hit) return null;
  const formatted = formatITunesTrack(hit);
  if (!formatted) return null;
  return { ...formatted, source: 'itunes' };
}

/**
 * Successful resolutions, keyed by lower-cased "title / artist". Only
 * successes are memoised: a failure (both sources down, no match) retries
 * on the next attempt instead of being stuck until reload.
 */
const resolvedCache = new Map<string, ExternalStream>();

/**
 * Resolve a playable stream for a song from the Spotify repo's legal
 * sources: Audius full streams first, then an iTunes 30-second preview.
 * Returns null when neither source has the song. Never throws — every
 * host failure is a null, so the caller's fallback chain just moves on.
 */
export async function resolveExternalStream(
  title: string,
  artist: string,
  fetcher: FetchFn = fetch,
): Promise<ExternalStream | null> {
  const cleanTitleArg = title?.trim() || '';
  const cleanArtistArg = artist?.trim() || '';
  if (!cleanTitleArg) return null;
  const key = `${cleanTitleArg.toLowerCase()} / ${cleanArtistArg.toLowerCase()}`;
  const cached = resolvedCache.get(key);
  if (cached) return cached;
  const resolved =
    (await resolveFromAudius(cleanTitleArg, cleanArtistArg, fetcher)) ??
    (await resolveFromITunes(cleanTitleArg, cleanArtistArg, fetcher));
  if (resolved) resolvedCache.set(key, resolved);
  return resolved;
}
