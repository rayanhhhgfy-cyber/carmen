/**
 * Minimal API client for the FastAPI backend.
 *
 * Typed port of frontend/src/api.js. RN's fetch is global, but `new URL()`
 * is not available under some React Native builds, so the query string is
 * assembled by hand (no `URLSearchParams`).
 */
import { API_BASE } from '../config';

/** Extra query parameters accepted by `apiGet`. */
export type ApiParams = Record<string, string | number | boolean | undefined | null>;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * `?a=1&b=2` for the given params — undefined, null and empty-string values
 * are dropped, exactly like the web client's `URLSearchParams.set` skipping.
 * Returns `''` when nothing survives filtering.
 */
export function buildQuery(params?: ApiParams): string {
  if (!params) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

/**
 * GET a JSON payload from the backend.
 *
 * @param path e.g. "/browsing/home"
 * @param params query parameters
 * @param signal abort signal
 */
export async function apiGet<T>(
  path: string,
  params?: ApiParams,
  signal?: AbortSignal,
): Promise<T> {
  const url = API_BASE + path + buildQuery(params);

  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if ((error as { name?: string } | null)?.name === 'AbortError') throw error;
    throw new ApiError('Cannot reach the server', 0, null);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const body =
      payload && typeof payload === 'object'
        ? (payload as { detail?: unknown; message?: unknown })
        : null;
    const detail =
      (body && (body.detail || body.message)) ||
      `Request failed (${response.status})`;
    throw new ApiError(String(detail), response.status, payload);
  }
  return payload as T;
}

/** Absolute URL of the proxied audio stream for a video. */
export function streamUrl(videoId: string): string {
  return `${API_BASE}/stream?vidId=${encodeURIComponent(videoId)}`;
}
