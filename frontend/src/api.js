/**
 * Minimal API client for the FastAPI backend.
 */
const RAW_BASE = import.meta.env.VITE_API_BASE || 'http://23.95.128.182:7181';

/** Base URL of the backend, without a trailing slash. */
export const API_BASE = String(RAW_BASE).replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

/**
 * GET a JSON payload from the backend.
 *
 * @param {string} path e.g. "/browsing/home"
 * @param {Record<string, string|number|boolean|undefined|null>} [params]
 * @param {AbortSignal} [signal]
 */
export async function apiGet(path, params = {}, signal) {
  const url = new URL(API_BASE + path, window.location.href);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  let response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('Cannot reach the server', 0, null);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      (payload && (payload.detail || payload.message)) ||
      `Request failed (${response.status})`;
    throw new ApiError(detail, response.status, payload);
  }
  return payload;
}

/** Absolute URL of the proxied audio stream for a video. */
export function streamUrl(videoId) {
  return `${API_BASE}/stream?vidId=${encodeURIComponent(videoId)}`;
}
