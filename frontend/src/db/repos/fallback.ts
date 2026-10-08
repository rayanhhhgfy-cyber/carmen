/**
 * Browser fallback for sessions that run under plain `vite dev` (no Tauri
 * WebView → no SQLite). Only the stores the app needs to *render* are shimmed;
 * playlists / downloads simply report as empty.
 *
 * Inside the app this module is never used — `dbAvailable` is true there.
 */
import { dbAvailable } from '../connection';

export const usingFallback: boolean = !dbAvailable;

export function fallbackGet<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(`carmen.fb.${key}`);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function fallbackSet(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(`carmen.fb.${key}`, JSON.stringify(value));
  } catch {
    /* private mode / quota — browser dev only */
  }
}
