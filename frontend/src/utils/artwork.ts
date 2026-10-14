/**
 * Throttled artwork loader.
 *
 * YouTube's image CDN answers `429 Too Many Requests` when a page asks for a
 * few dozen covers at once, so every artwork request goes through this queue:
 *
 *  - requests are issued **one at a time, at least 0.5s apart**;
 *  - a `429` is retried with a growing backoff instead of failing;
 *  - successful URLs are remembered, so scrolling back is instant and costs
 *    no network request at all.
 *
 * On top of that the bytes are written to **Cache Storage**, a persistent
 * store that survives reloads: a cover fetched once is painted from disk on
 * every later visit (as an object URL) without touching the CDN.  When Cache
 * Storage is unavailable — a non-secure origin, a storage-blocked profile —
 * the loader silently degrades to the browser's normal HTTP cache.
 */

/** Minimum delay between two artwork requests — the CDN rate limit guard. */
export const ARTWORK_GAP_MS = 500;

/** Sizes the i.ytimg CDN exposes for a video, largest first. */
const YTIMG_SIZES = ['maxresdefault', 'hq720', 'sddefault', 'hqdefault'];
// the WebP twin (`vi_webp/…webp`) is matched so it still gets a fallback,
// but it is never produced again: some browsers fail to paint WebP
const YTIMG_RE =
  /^https:\/\/i\.ytimg\.com\/(?:vi_webp|vi)\/([\w-]{11})\/([\w-]+)\.(?:webp|jpg|png)$/;

/**
 * Smaller alternatives of an i.ytimg artwork, largest first, **JPEG only**.
 *
 * `maxresdefault` does not exist for every upload, so a tile that fails to
 * paint walks down this list (`maxresdefault.jpg` → `hq720.jpg` → …)
 * instead of leaving an empty box behind.
 *
 * @param url artwork URL
 * @returns candidate URLs, never containing *url* itself
 */
export function artworkFallbacks(url: string): string[] {
  const match = YTIMG_RE.exec(url || '');
  if (!match) return [];
  const videoId = match[1];
  const size = match[2];
  const start = YTIMG_SIZES.indexOf(size);
  const out: string[] = [];
  for (const candidate of YTIMG_SIZES.slice(start < 0 ? 0 : start)) {
    out.push(`https://i.ytimg.com/vi/${videoId}/${candidate}.jpg`);
  }
  return [...new Set(out)].filter((candidate) => candidate !== url);
}

const RETRY_DELAY_MS = 500;
const RETRY_BACKOFF_MS = [1500, 4000];
const MAX_ATTEMPTS = 1 + RETRY_BACKOFF_MS.length;

const ready = new Set<string>();
const failed = new Set<string>();
const inFlight = new Map<string, Promise<string | null>>();

let queue: { url: string; resolve: (value: string | null) => void }[] = [];
let pumping = false;
let lastStart = 0;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** True when this url already loaded successfully during this session. */
export function isArtworkReady(url?: string | null): boolean {
  return Boolean(url) && (ready.has(url as string) || isLocalArtworkUrl(url as string));
}

/**
 * Non-network artwork (`data:`, `blob:`, `asset:`) — the cover of a downloaded
 * song read straight from the sandbox. The bytes are already in the document,
 * so there is nothing to fetch, throttle or cache: the loader hands the URL
 * back as-is and the tile paints it directly.
 */
export function isLocalArtworkUrl(url: string): boolean {
  return Boolean(url) && !/^https?:\/\//i.test(url);
}

/* ------------------------------------------------------------------ *
 * Persistent byte store (Cache Storage) + object URLs for painting.
 * ------------------------------------------------------------------ */

const CACHE_NAME = 'carmen-artwork-v1';
/** Covers kept on disk; the oldest are dropped past this. */
const MAX_CACHED_ARTWORK = 400;
const TRIM_EVERY = 25;

let cachePromise: Promise<Cache | null> | undefined;
let writesSinceTrim = 0;

/** Opens the cache once; `null` means "not available here". */
function artworkCache(): Promise<Cache | null> {
  if (cachePromise === undefined) {
    cachePromise =
      typeof caches !== 'undefined'
        ? caches.open(CACHE_NAME).catch(() => null)
        : Promise.resolve(null);
  }
  return cachePromise;
}

/** Stored bytes for *url*, or `null` when there is nothing usable. */
async function readStored(url: string): Promise<Blob | null> {
  try {
    const cache = await artworkCache();
    if (!cache) return null;
    const response = await cache.match(url);
    if (!response) return null;
    const blob = await response.blob();
    return blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
}

async function trim(cache: Cache): Promise<void> {
  try {
    const keys = await cache.keys();
    if (keys.length <= MAX_CACHED_ARTWORK) return;
    for (const request of keys.slice(0, keys.length - MAX_CACHED_ARTWORK)) {
      await cache.delete(request);
    }
  } catch {
    /* never let housekeeping break a download */
  }
}

async function store(url: string, blob: Blob): Promise<void> {
  try {
    const cache = await artworkCache();
    if (!cache) return;
    await cache.put(
      url,
      new Response(blob, { headers: { 'Content-Type': blob.type || 'image/jpeg' } }),
    );
    writesSinceTrim += 1;
    if (writesSinceTrim >= TRIM_EVERY) {
      writesSinceTrim = 0;
      await trim(cache);
    }
  } catch {
    /* quota or private mode — the HTTP cache still covers this visit */
  }
}

/** Total bytes of the covers kept in Cache Storage (Settings → Storage). */
export async function artworkCacheSize(): Promise<number> {
  try {
    const cache = await artworkCache();
    if (!cache) return 0;
    let total = 0;
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      if (response) total += (await response.blob()).size;
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Drops every cached cover (Settings → Storage → Clear). The cache handle
 * itself stays open — emptied, not deleted — so later `store` writes need
 * no re-open.
 */
export async function clearArtworkCache(): Promise<void> {
  try {
    const cache = await artworkCache();
    if (!cache) return;
    for (const request of await cache.keys()) {
      await cache.delete(request);
    }
  } catch {
    /* best effort */
  }
}

/**
 * source url -> `blob:` url already handed to an `<img>`.
 *
 * A **bounded LRU**: every entry pins its Blob in memory for as long as the
 * object URL lives, and a long session paints one cover per tile ever
 * shown (home shelves + a 100-result search + related grids + the player)
 * — an unbounded map here is exactly the slow accumulation that takes an
 * iOS Safari tab down (jetsam, page reload). The oldest URLs are revoked
 * once the cap is passed: an `<img>` that already painted keeps its decoded
 * frame, and a tile that scrolls back into view re-creates its object URL
 * from the persistent store (see `loadArtwork`).
 */
const painted = new Map<string, string>();

/** Covers whose object URLs stay alive at once. */
const PAINTED_LIMIT = 200;

/** Register *objectUrl*, evicting (and revoking) the least recently used. */
function rememberPainted(url: string, objectUrl: string): void {
  painted.delete(url);
  painted.set(url, objectUrl);
  while (painted.size > PAINTED_LIMIT) {
    const oldest = painted.keys().next().value;
    if (oldest === undefined) break;
    const revoked = painted.get(oldest);
    painted.delete(oldest);
    if (revoked) URL.revokeObjectURL(revoked);
  }
}

/** Object URL for *url*, created at most once. Falls back to the plain URL. */
function paintWith(url: string, blob: Blob): string {
  const existing = painted.get(url);
  if (existing) {
    rememberPainted(url, existing); // in use — it must survive the eviction
    return existing;
  }
  try {
    const objectUrl = URL.createObjectURL(blob);
    rememberPainted(url, objectUrl);
    return objectUrl;
  } catch {
    return url;
  }
}

/**
 * Blob URL already prepared for *url*, or `null`.
 *
 * Lets a component paint the cached copy on its very first render instead of
 * showing the source URL and swapping once the blob arrives. A hit is also a
 * LRU *touch* — covers still on screen never fall out of the cap.
 *
 * @param url artwork URL
 */
export function paintedArtwork(url?: string | null): string | null {
  const hit = url ? painted.get(url) : undefined;
  if (!url || !hit) return null;
  rememberPainted(url, hit);
  return hit;
}

type FetchOutcome =
  | { outcome: 'ok'; blob: Blob }
  | { outcome: 'failed' | 'rate-limited'; blob?: undefined };

async function request(url: string): Promise<FetchOutcome> {
  try {
    const response = await fetch(url, { mode: 'cors', cache: 'force-cache' });
    if (response.status === 429 || response.status === 503) {
      return { outcome: 'rate-limited' };
    }
    if (!response.ok) return { outcome: 'failed' };
    // read the body: it lands in the HTTP cache *and* in the persistent store
    const blob = await response.blob();
    return blob.size > 0 ? { outcome: 'ok', blob } : { outcome: 'failed' };
  } catch {
    return { outcome: 'failed' };
  }
}

/** @returns the bytes once they are stored, or `null` when all attempts failed */
async function attempt(url: string): Promise<Blob | null> {
  for (let index = 0; index < MAX_ATTEMPTS; index += 1) {
    const { outcome, blob } = await request(url);
    if (blob) {
      await store(url, blob);
      return blob;
    }
    if (outcome === 'rate-limited' && index < MAX_ATTEMPTS - 1) {
      await delay(index === 0 ? RETRY_DELAY_MS : RETRY_BACKOFF_MS[index - 1]);
      continue;
    }
    if (outcome === 'failed' && index === 0) {
      // one quick retry covers transient hiccups without stalling the queue
      await delay(RETRY_DELAY_MS);
      continue;
    }
    break;
  }
  return null;
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;

  while (queue.length) {
    const wait = ARTWORK_GAP_MS - (Date.now() - lastStart);
    if (wait > 0) await delay(wait);

    const item = queue.shift();
    if (!item) break;
    lastStart = Date.now();

    const blob = await attempt(item.url);
    inFlight.delete(item.url);
    if (blob) {
      ready.add(item.url);
      failed.delete(item.url);
      item.resolve(paintWith(item.url, blob));
    } else {
      failed.add(item.url);
      item.resolve(null);
    }
  }

  pumping = false;
}

/**
 * Queue an artwork download and resolve with the URL to paint once the bytes
 * are stored — a `blob:` URL served from the persistent cache — or with
 * `null` when it could not be fetched.
 *
 * A cover kept by an earlier visit resolves immediately, without entering
 * the queue and without spending any of the CDN's rate-limit budget.
 *
 * @param url image URL
 */
export function loadArtwork(url?: unknown): Promise<string | null> {
  if (!url || typeof url !== 'string') return Promise.resolve(null);
  if (isLocalArtworkUrl(url)) return Promise.resolve(url);
  if (ready.has(url)) {
    const existing = paintedArtwork(url);
    if (existing) return Promise.resolve(existing);
    // The object URL was evicted from the LRU cap (or revoked on a tab
    // that painted a lot of covers) — rebuild it from the persistent
    // store, which costs a disk read and no network at all.
    return readStored(url).then((stored) => (stored ? paintWith(url, stored) : url));
  }
  const pending = inFlight.get(url);
  if (pending) return pending;

  const promise = (async (): Promise<string | null> => {
    const stored = await readStored(url);
    inFlight.delete(url);
    if (stored) {
      ready.add(url);
      failed.delete(url);
      return paintWith(url, stored);
    }
    return new Promise<string | null>((resolve) => {
      queue.push({ url, resolve });
      void pump();
    });
  })();

  inFlight.set(url, promise);
  return promise;
}

/** Queue an artwork download without waiting for it. */
export function warmArtwork(url?: unknown): void {
  void loadArtwork(url);
}

/**
 * Average color of an artwork, used to tint the ambient background.
 *
 * **The canvas pass runs once per cover, for the lifetime of the session.**
 * The promise (not just the value) is what gets cached, so a track revisited
 * — or two components asking at once — never re-extracts: the 8×8 downscale,
 * the `getImageData` read and (on a cold cache) the fetch all happen a
 * single time per unique artwork URL, which is the artwork identity of a
 * track.  The map is capped like the other session caches, and a *failed*
 * extraction is dropped instead of remembered, so a cold CDN never freezes
 * a cover into a colourless tint.
 *
 * Reads the stored copy first — the `<img>` already pulled those bytes — so
 * this rarely costs a network request.  Returns `null` when the CDN does not
 * allow reading the pixels.
 *
 * @param url image URL
 * @returns `#rrggbb`
 */
const colorCache = new Map<string, Promise<string | null>>();
/** Covers remembered; the oldest insertion drops when the cap is passed. */
const COLOR_CACHE_LIMIT = 300;

export async function extractColor(url?: string | null): Promise<string | null> {
  if (!url) return null;
  const remembered = colorCache.get(url);
  if (remembered) return remembered;
  const pass = sampleColor(url);
  colorCache.set(url, pass);
  if (colorCache.size > COLOR_CACHE_LIMIT) {
    colorCache.delete(colorCache.keys().next().value as string);
  }
  // A miss stays a miss only until the next try — never cache a failure.
  void pass.then((value) => {
    if (!value) colorCache.delete(url);
  });
  return pass;
}

/** The uncached extraction pass behind {@link extractColor}. */
async function sampleColor(url: string): Promise<string | null> {
  try {
    let blob = await readStored(url);
    if (!blob) {
      const response = await fetch(url, { mode: 'cors', cache: 'force-cache' });
      if (!response.ok) return null;
      blob = await response.blob();
      void store(url, blob);
    }
    // The bitmap is released explicitly: WebKit keeps decoded bitmaps alive
    // well past their last reference otherwise, and one per cover is a lot
    // of pixel memory to leave to the GC on iOS.
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 8;
      canvas.height = 8;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(bitmap, 0, 0, 8, 8);
      const { data } = context.getImageData(0, 0, 8, 8);

      let red = 0;
      let green = 0;
      let blue = 0;
      let weight = 0;
      for (let index = 0; index < data.length; index += 4) {
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        // favor saturated pixels: they read as the artwork's "theme"
        const saturation = max === 0 ? 0 : (max - min) / max;
        const value = 0.35 + saturation;
        red += r * value;
        green += g * value;
        blue += b * value;
        weight += value;
      }
      if (!weight) return null;
      const toHex = (channel: number) =>
        Math.max(0, Math.min(255, Math.round(channel / weight)))
          .toString(16)
          .padStart(2, '0');
      return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
    } finally {
      bitmap.close?.();
    }
  } catch {
    return null;
  }
}
