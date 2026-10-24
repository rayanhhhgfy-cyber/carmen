/**
 * Storage durability — asking the browser to *keep* the offline library.
 *
 * IndexedDB starts out "best-effort": under storage pressure the browser
 * may evict an origin's data wholesale, which silently deletes every
 * downloaded song a few days after it was saved. `navigator.storage
 * .persist()` promotes the origin to durable storage. Nothing ever asked
 * for it, so this helper does — once per session, the first time it is
 * called, and never again when the storage is already persisted.
 *
 * Web only: inside Tauri the songs live on the real filesystem, which no
 * browser eviction can touch, so this is a no-op there (and on any
 * browser without the Storage API).
 */
import { isTauri } from '../env';

let persistRequested = false;

/**
 * Ensures this origin's storage is persistent, requesting it if needed.
 *
 * @returns `true` when the storage is (now) persisted, `false` when the
 * request was declined, unsupported, or not applicable (Tauri).
 */
export async function ensurePersistentStorage(): Promise<boolean> {
  if (isTauri) return false;
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (
    !storage ||
    typeof storage.persist !== 'function' ||
    typeof storage.persisted !== 'function'
  ) {
    return false;
  }
  try {
    if (await storage.persisted()) return true;
    // One request per session is enough — a declined browser does not
    // change its mind because a second playlist asked louder.
    if (persistRequested) return false;
    persistRequested = true;
    return await storage.persist();
  } catch {
    return false;
  }
}
