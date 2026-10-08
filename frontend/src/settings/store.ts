/**
 * Application settings — one store, persisted in SQLite (`settings` table),
 * read synchronously by React through `useSyncExternalStore`.
 *
 * `hydrateSettings()` runs once during bootstrap (see `main.tsx`) *before*
 * React renders, so the first frame already wears the saved theme / lyrics
 * provider. Legacy `localStorage` keys from the web build are migrated into
 * the database the first time the app runs.
 */
import { useSyncExternalStore } from 'react';

import { getSetting, setSetting } from '../db/repos/settings';
import type { AppSettings, FontId, LyricsProvider, SettingsKey, ThemeMode } from '../types/models';

export const DEFAULT_SETTINGS: AppSettings = {
  themeMode: 'system',
  accent: '#4CAF50',
  adaptiveAccent: false,
  font: 'alexandria',
  lyricsProvider: 'auto',
  apiBase: '',
  highPerformance: false,
};

const KEYS: SettingsKey[] = [
  'themeMode',
  'accent',
  'adaptiveAccent',
  'font',
  'lyricsProvider',
  'apiBase',
  'highPerformance',
];

/** Pre-SQLite storage keys, read once so existing choices survive. */
const LEGACY_KEYS: Partial<Record<SettingsKey, string[]>> = {
  themeMode: ['carmen:themeMode', 'samma3ni:themeMode'],
  accent: ['carmen:accent', 'samma3ni:accent'],
  adaptiveAccent: ['carmen:adaptiveAccent'],
  font: ['carmen:font.v2'],
};

const THEME_MODES: ThemeMode[] = ['light', 'dark', 'system'];
const FONTS: FontId[] = ['alexandria', 'cairo', 'system'];
const LYRICS: LyricsProvider[] = ['auto', 'lrclib', 'musixmatch', 'netease', 'megalobiz', 'genius'];

let snapshot: AppSettings = { ...DEFAULT_SETTINGS };
let hydrated = false;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

function readLegacy(key: SettingsKey): string | null {
  try {
    for (const legacyKey of LEGACY_KEYS[key] ?? []) {
      const value = window.localStorage.getItem(legacyKey);
      if (value) return value;
    }
  } catch {
    /* private mode */
  }
  return null;
}

function coerce(key: SettingsKey, raw: string): AppSettings[SettingsKey] {
  switch (key) {
    case 'themeMode':
      return THEME_MODES.includes(raw as ThemeMode) ? (raw as ThemeMode) : DEFAULT_SETTINGS.themeMode;
    case 'font':
      return FONTS.includes(raw as FontId) ? (raw as FontId) : DEFAULT_SETTINGS.font;
    case 'lyricsProvider':
      return LYRICS.includes(raw as LyricsProvider)
        ? (raw as LyricsProvider)
        : DEFAULT_SETTINGS.lyricsProvider;
    case 'adaptiveAccent':
      return raw === '1' || raw === 'true';
    case 'highPerformance':
      return raw === '1' || raw === 'true';
    case 'accent':
      return /^#[0-9a-f]{6}$/i.test(raw) ? raw : DEFAULT_SETTINGS.accent;
    case 'apiBase':
      return raw;
    default:
      return raw;
  }
}

function serialize(key: SettingsKey, value: AppSettings[SettingsKey]): string {
  if (key === 'adaptiveAccent' || key === 'highPerformance') return value ? '1' : '0';
  return String(value ?? '');
}

/** Loads persisted settings (plus one-time legacy migration) into memory. */
export async function hydrateSettings(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  const next: AppSettings = { ...DEFAULT_SETTINGS };
  for (const key of KEYS) {
    let raw: string | null = null;
    try {
      raw = await getSetting(key);
    } catch {
      raw = null;
    }
    if (raw === null || raw === undefined) {
      const legacy = readLegacy(key);
      if (legacy !== null) {
        raw = legacy;
        void setSetting(key, legacy).catch(() => {});
      }
    }
    if (raw !== null && raw !== undefined) {
      Object.assign(next, { [key]: coerce(key, raw) });
    }
  }
  snapshot = next;
  notify();
}

export function getSettingsSnapshot(): AppSettings {
  return snapshot;
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Patch + persist. Writes are fire-and-forget; reads are synchronous. */
export function updateSettings(patch: Partial<AppSettings>): void {
  snapshot = { ...snapshot, ...patch };
  notify();
  for (const [key, value] of Object.entries(patch)) {
    const settingsKey = key as SettingsKey;
    if (value === undefined) continue;
    void setSetting(settingsKey, serialize(settingsKey, value as AppSettings[SettingsKey])).catch(
      (error) => console.warn('[settings] persist failed', settingsKey, error),
    );
  }
}

/** Live view of every persisted setting. */
export function useSettings(): AppSettings {
  return useSyncExternalStore(subscribeSettings, getSettingsSnapshot, getSettingsSnapshot);
}

/**
 * Whether the expensive visual effects should paint at all: blur and
 * backdrop-filter, accent glows and the ambient artwork background.
 *
 * High performance mode switches them off app-wide, so every effectful
 * component asks through this hook instead of reaching for the raw setting —
 * the meaning lives in one place and the call sites read as intent.
 */
export function useEffectsEnabled(): boolean {
  return !useSettings().highPerformance;
}
