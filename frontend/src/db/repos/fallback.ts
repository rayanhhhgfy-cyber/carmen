/**
 * Browser fallback for sessions that run without Tauri's SQLite (plain
 * `vite dev`, the deployed web build, iOS Safari / PWA).
 *
 * The seam itself is unchanged — repositories keep calling
 * `fallbackGet`/`fallbackSet` with localStorage's synchronous shape — but
 * the durable copy now lives in IndexedDB through `services/storage`
 * (memory cache for reads, write-behind persist, localStorage mirror for
 * durability and migration). `hydrateBrowserStorage()` seeds the cache from
 * the historical `carmen.fb.*` shims on first boot, so every playlist,
 * setting, favorite and resume position from an older browser session
 * survives the move.
 *
 * Inside the Tauri app this module is never used — `dbAvailable` is true
 * there and no repository reaches these helpers.
 */
import { kvRead, kvWrite } from '../../services/storage';
import { dbAvailable } from '../connection';

export const usingFallback: boolean = !dbAvailable;

export function fallbackGet<T>(key: string, fallback: T): T {
  try {
    return kvRead(key, fallback);
  } catch {
    return fallback;
  }
}

export function fallbackSet(key: string, value: unknown): void {
  try {
    kvWrite(key, value);
  } catch {
    /* storage blocked — the session keeps serving from memory */
  }
}
