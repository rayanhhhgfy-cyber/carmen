/**
 * Release check against the GitHub repo — runs at startup inside the Tauri
 * app (the web build is redeployed by CI, so it never needs updating).
 *
 * Deliberately network-loose: GitHub's API is CORS-open, so the webview's
 * plain `fetch` works without touching the `http` plugin allowlist. Every
 * failure (offline, rate limit, garbage payload) resolves to `null` — the
 * check must never delay or break startup.
 */
import { appInfo, isTauri, openExternal } from '../platform/env';

const LATEST_RELEASE_URL = 'https://api.github.com/repos/z44d/carmen/releases/latest';
export const RELEASES_PAGE = 'https://github.com/z44d/carmen/releases/latest';
const DISMISSED_KEY = 'carmen.update.dismissed';

export interface UpdateInfo {
  current: string;
  latest: string;
  url: string;
}

/** "1.2.3" → [1, 2, 3]; non-numeric parts count as 0. */
function parseVersion(version: string): number[] {
  return version.replace(/^v/, '').split('.').map((part) => Number.parseInt(part, 10) || 0);
}

/** True when `latest` is a strictly newer release than `current`. */
export function isNewerVersion(latest: string, current: string): boolean {
  const l = parseVersion(latest);
  const c = parseVersion(current);
  const len = Math.max(l.length, c.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (l[i] ?? 0) - (c[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/**
 * Asks GitHub for the latest release and compares it with the running
 * build. Resolves `null` when there is nothing to offer: not Tauri,
 * offline, API error, same/older tag, or a version the user dismissed.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri) return null;

  let current: string;
  try {
    ({ version: current } = await appInfo());
  } catch {
    return null;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(LATEST_RELEASE_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) return null;

    const release = (await response.json()) as { tag_name?: string };
    const latest = release.tag_name ?? '';
    if (!latest || !isNewerVersion(latest, current)) return null;
    if (localStorage.getItem(DISMISSED_KEY) === latest) return null;
    return { current, latest, url: RELEASES_PAGE };
  } catch {
    return null; // offline / timed out / rate-limited — never block startup
  }
}

/** "Later": remember the offer so the same version stops asking. */
export function dismissUpdate(version: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    /* private mode / storage full — asking again next launch is fine */
  }
}

/** Opens the releases page in the system browser. */
export function openReleasesPage(): Promise<void> {
  return openExternal(RELEASES_PAGE);
}
