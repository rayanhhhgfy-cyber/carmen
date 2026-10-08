/**
 * SQLite connection + migration runner.
 *
 * One connection for the whole app, opened once during the bootstrap phase in
 * `main.tsx` before React renders, so every repository can assume the schema
 * exists.
 */
import Database from '@tauri-apps/plugin-sql';

import { isTauri } from '../platform/env';
import { MIGRATIONS, splitStatements } from './migrations';

export const DATABASE_NAME = 'sqlite:carmen.db';

let dbPromise: Promise<Database> | null = null;

/** True when the SQLite-backed store is available (i.e. running in Tauri). */
export const dbAvailable: boolean = isTauri;

/** Opens (and migrates) the app database. Throws outside of Tauri. */
export function getDb(): Promise<Database> {
  if (!dbPromise) dbPromise = open();
  return dbPromise;
}

async function open(): Promise<Database> {
  const db = await Database.load(DATABASE_NAME);
  await db.execute('PRAGMA foreign_keys = ON');
  await runMigrations(db);
  return db;
}

async function runMigrations(db: Database): Promise<void> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY,
       name TEXT NOT NULL DEFAULT '',
       applied_at INTEGER NOT NULL
     )`,
  );

  const rows = await db.select<{ v: number | null }[]>(
    'SELECT MAX(version) AS v FROM schema_migrations',
  );
  const current = Number(rows[0]?.v ?? 0);

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    for (const statement of splitStatements(migration.sql)) {
      await db.execute(statement);
    }
    await db.execute(
      'INSERT INTO schema_migrations(version, name, applied_at) VALUES ($1, $2, $3)',
      [migration.version, migration.name, Date.now()],
    );
  }
}

/** JSON helpers shared by the repositories. */
export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function fromJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

/** SQLite has no booleans — 0/1 in, boolean out. */
export function toBool(value: unknown): boolean {
  return value === 1 || value === true || value === '1';
}

export function fromBool(value: boolean): number {
  return value ? 1 : 0;
}
