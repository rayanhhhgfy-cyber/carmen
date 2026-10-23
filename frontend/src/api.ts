/**
 * Minimal API client for the FastAPI backend.
 */
import { getSettingsSnapshot } from './settings/store';
import type { LyricsProvider } from './types/models';

const ENV_BASE = import.meta.env.VITE_API_BASE || 'https://api-carmen-v1.syr.qzz.io';

function trimBase(value: unknown): string {
  return String(value || '').replace(/\/+$/, '');
}

/**
 * Base URL of the backend, without a trailing slash.
 *
 * Resolved per request so the "Server URL" override in Settings applies
 * without a restart (falls back to `VITE_API_BASE`, then the demo server).
 */
export function apiBase(): string {
  const override = getSettingsSnapshot().apiBase;
  return trimBase(override) || trimBase(ENV_BASE);
}

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

/**
 * GET a JSON payload from the backend.
 *
 * @param path e.g. "/browsing/home"
 * @param params query string parameters (empty values are skipped)
 * @param signal abort signal
 */
export async function apiGet(path: string, params: QueryParams = {}, signal?: AbortSignal): Promise<any> {
  const url = new URL(apiBase() + path, window.location.href);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new ApiError('Cannot reach the server', 0, null);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      (payload && (payload.detail || payload.message)) ||
      `Request failed (${response.status})`;
    throw new ApiError(String(detail), response.status, payload);
  }
  return payload;
}

/**
 * POST a JSON body to the backend and parse the JSON response.
 *
 * Same error plumbing as `apiGet`: network failures and non-2xx answers
 * surface as `ApiError` carrying the server's `detail` message.
 *
 * @param path e.g. "/share/playlists"
 * @param body JSON-serializable request body
 * @param signal abort signal
 */
export async function apiPostJson(path: string, body: unknown, signal?: AbortSignal): Promise<any> {
  let response: Response;
  try {
    response = await fetch(apiBase() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal,
    });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new ApiError('Cannot reach the server', 0, null);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      (payload && (payload.detail || payload.message)) ||
      `Request failed (${response.status})`;
    throw new ApiError(String(detail), response.status, payload);
  }
  return payload;
}

/** Absolute URL of the proxied audio stream for a video. */
export function streamUrl(videoId: string): string {
  return `${apiBase()}/stream?vidId=${encodeURIComponent(videoId)}`;
}

/**
 * Session memo of enriched track payloads (metadata **and** lyrics).
 *
 * `/browsing/track` already returns the lyrics alongside the rest of the track
 * data, so one call per song is enough; this cache makes flipping back to a
 * recently played song — or reopening the player — reuse that payload instead
 * of asking the server again. Keyed by video id + lyrics provider (a provider
 * change is a different answer), and failures are evicted so they retry.
 */
const trackMetaCache = new Map<string, Promise<any>>();

/** Enriched track metadata with the configured lyrics provider applied. */
export async function fetchTrackMeta(
  videoId: string,
  lyricsProvider: LyricsProvider,
  signal?: AbortSignal,
): Promise<any> {
  const key = `${videoId}:${lyricsProvider || 'auto'}`;
  const cached = trackMetaCache.get(key);
  if (cached) return cached;

  // `auto` is the server default — omit the query so cached entries shared
  // between "Auto" and unset clients stay identical.
  const request = apiGet(
    `/browsing/track/${videoId}`,
    lyricsProvider && lyricsProvider !== 'auto' ? { provider: lyricsProvider } : {},
    signal,
  ).catch((error) => {
    trackMetaCache.delete(key); // never memo a failure — let it retry
    throw error;
  });
  trackMetaCache.set(key, request);
  return request;
}
