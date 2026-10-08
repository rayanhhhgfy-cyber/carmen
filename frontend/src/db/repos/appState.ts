/**
 * `app_state` table — small JSON blobs the app restores at startup.
 *
 * The important one is `navigation`: the exact route (and query string) is
 * written on every navigation so a close-to-tray hide *or* a full process
 * kill can never lose the user's place.
 */
import { fromJson, getDb, toJson } from '../connection';
import { fallbackGet, fallbackSet, usingFallback } from './fallback';

export async function saveAppState(key: string, value: unknown): Promise<void> {
  if (usingFallback) {
    fallbackSet(`appState.${key}`, value);
    return;
  }
  const db = await getDb();
  await db.execute(
    `INSERT INTO app_state (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, toJson(value)],
  );
}

export async function loadAppState<T>(key: string, fallback: T): Promise<T> {
  if (usingFallback) return fallbackGet<T>(`appState.${key}`, fallback);
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    'SELECT value FROM app_state WHERE key = $1',
    [key],
  );
  if (!rows.length) return fallback;
  return fromJson<T>(rows[0].value, fallback);
}

export interface NavigationState {
  pathname: string;
  search: string;
}

export const NAVIGATION_KEY = 'navigation';
export const LIBRARY_SECTION_KEY = 'librarySection';
