/**
 * Offline storage plumbing — every byte the app keeps on disk lives under the
 * sandboxed application data directory handed to us by Rust
 * (`commands::app::storage_paths`), written through `@tauri-apps/plugin-fs`
 * with a scope of `$APPDATA/**`.
 *
 * Layout:
 *   <app data>/songs/<videoId>/audio.<m4a|webm|ogg|mp3>
 *   <app data>/songs/<videoId>/artwork.<jpg|webp|png>
 *   <app data>/songs/<videoId>/lyrics.<lrc|txt>
 *   <app data>/artwork/…            (spare covers for OS media controls)
 */
import { exists, mkdir, readFile, remove, writeFile } from '@tauri-apps/plugin-fs';

import { isTauri, storagePaths } from '../platform/env';

let songsDirectory: string | null = null;
let artworkDirectory: string | null = null;
let init: Promise<void> | null = null;

async function ensureDirs(): Promise<void> {
  const paths = await storagePaths();
  songsDirectory = paths.songsDir;
  artworkDirectory = paths.artworkDir;
  if (isTauri) {
    await mkdir(paths.songsDir, { recursive: true }).catch(() => {});
    await mkdir(paths.artworkDir, { recursive: true }).catch(() => {});
  }
}

function dirs(): Promise<void> {
  if (!init) init = ensureDirs().catch(() => {});
  return init;
}

export async function songsDir(): Promise<string | null> {
  await dirs();
  return songsDirectory;
}

export async function artworkDir(): Promise<string | null> {
  await dirs();
  return artworkDirectory;
}

/** `<songs>/<videoId>` — created on demand. */
export async function songFolder(videoId: string): Promise<string | null> {
  const base = await songsDir();
  if (!base) return null;
  const folder = `${base}/${videoId}`;
  if (isTauri) await mkdir(folder, { recursive: true }).catch(() => {});
  return folder;
}

export async function fileExists(path: string): Promise<boolean> {
  if (!isTauri) return false;
  try {
    return await exists(path);
  } catch {
    return false;
  }
}

export async function writeBinary(path: string, data: Uint8Array): Promise<void> {
  await writeFile(path, data);
}

export async function writeText(path: string, text: string): Promise<void> {
  await writeFile(path, new TextEncoder().encode(text));
}

export async function readBinary(path: string): Promise<Uint8Array | null> {
  if (!isTauri) return null;
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

export async function readText(path: string): Promise<string | null> {
  if (!isTauri) return null;
  try {
    const bytes = await readFile(path);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export async function deletePath(path: string): Promise<void> {
  if (!isTauri) return;
  try {
    await remove(path, { recursive: true });
  } catch {
    /* already gone */
  }
}

/** Deletes a whole `songs/<videoId>` folder. */
export async function deleteSongFolder(videoId: string): Promise<void> {
  const base = await songsDir();
  if (!base) return;
  await deletePath(`${base}/${videoId}`);
}

/** `bytes` → base64 (chunked so large covers never blow the argument list). */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}
