/**
 * Minimal API client for the FastAPI backend.
 */
import { getSettingsSnapshot } from './settings/store';
import type { LyricsProvider } from './types/models';

const ENV_BASE = import.meta.env.VITE_API_BASE || 'http://23.95.128.182:7181';

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

/** Absolute URL of the proxied audio stream for a video. */
export function streamUrl(videoId: string): string {
  return `${apiBase()}/stream?vidId=${encodeURIComponent(videoId)}`;
}

/** Enriched track metadata with the configured lyrics provider applied. */
export async function fetchTrackMeta(
  videoId: string,
  lyricsProvider: LyricsProvider,
  signal?: AbortSignal,
): Promise<any> {
  // `auto` is the server default — omit the query so cached entries shared
  // between "Auto" and unset clients stay identical.
  return apiGet(
    `/browsing/track/${videoId}`,
    lyricsProvider && lyricsProvider !== 'auto' ? { provider: lyricsProvider } : {},
    signal,
  );
}
