/** `settings` table — user configurable key/value pairs. */
import { getDb } from '../connection';
import { usingFallback, fallbackGet, fallbackSet } from './fallback';

export async function getSetting(key: string): Promise<string | null> {
  if (usingFallback) {
    const value = fallbackGet<string | null>(`settings.${key}`, null);
    return value;
  }
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    'SELECT value FROM settings WHERE key = $1',
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  if (usingFallback) {
    fallbackSet(`settings.${key}`, value);
    return;
  }
  const db = await getDb();
  await db.execute(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

export async function getAllSettings(): Promise<Record<string, string>> {
  if (usingFallback) return {};
  const db = await getDb();
  const rows = await db.select<{ key: string; value: string }[]>(
    'SELECT key, value FROM settings',
  );
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export async function deleteSetting(key: string): Promise<void> {
  if (usingFallback) {
    fallbackSet(`settings.${key}`, null);
    return;
  }
  const db = await getDb();
  await db.execute('DELETE FROM settings WHERE key = $1', [key]);
}
