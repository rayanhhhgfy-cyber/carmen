/**
 * Tauri platform bridge.
 *
 * Every native touch-point of the frontend goes through this module so the
 * app still runs under a plain `vite dev` server (browser fallbacks) and so
 * capability/permission changes only ever ripple through one file.
 */
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';

/** True when running inside the Tauri WebView, false under plain Vite. */
export const isTauri: boolean =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** True on desktop targets (Windows / macOS / Linux) — tray lives there. */
export const isDesktop: boolean =
  isTauri && !/android|iphone|ipad|ipod/i.test(navigator.userAgent);

export interface StoragePaths {
  appData: string;
  songsDir: string;
  artworkDir: string;
  database: string;
}

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  arch: string;
  desktop: boolean;
}

let pathsPromise: Promise<StoragePaths> | null = null;

/** Resolves the sandboxed storage locations (cached after the first call). */
export function storagePaths(): Promise<StoragePaths> {
  if (!pathsPromise) pathsPromise = invoke<StoragePaths>('storage_paths');
  return pathsPromise;
}

/** Static facts about this build (Settings → About). */
export function appInfo(): Promise<AppInfo> {
  return invoke<AppInfo>('app_info');
}

/**
 * URL an `<img>`/`<audio>` can consume for a file inside the app sandbox.
 * Uses the asset protocol; falls back to the raw path in a browser session.
 */
export function localFileUrl(path: string): string {
  return isTauri ? convertFileSrc(path) : path;
}

/** Opens an external link — `opener` plugin inside Tauri, new tab otherwise. */
export async function openExternal(url: string): Promise<void> {
  if (isTauri) {
    await openUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Tray menu → app. Payload: `{ action: 'toggle' | 'next' }`. */
export function onTrayAction(
  handler: (action: 'toggle' | 'next') => void,
): Promise<UnlistenFn> {
  if (!isTauri) return Promise.resolve(() => {});
  return listen<{ action: 'toggle' | 'next' }>('tray://action', (event) => {
    handler(event.payload.action);
  });
}

/** App → tray: keeps the tray menu's Play/Pause label honest. */
export function emitTrayState(playing: boolean): void {
  if (!isTauri) return;
  void emit('tray://state', { playing });
}

/** Asynchronous bootstrap performed before the first React render. */
export interface BootstrapInfo {
  paths: StoragePaths | null;
}

export async function bootstrapPlatform(): Promise<BootstrapInfo> {
  if (!isTauri) return { paths: null };
  try {
    return { paths: await storagePaths() };
  } catch (error) {
    console.warn('[tauri] storage paths unavailable', error);
    return { paths: null };
  }
}
