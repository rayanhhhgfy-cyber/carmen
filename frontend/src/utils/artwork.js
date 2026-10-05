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
const YTIMG_RE = /^https:\/\/i\.ytimg\.com\/(?:vi_webp|vi)\/([\w-]{11})\/([\w-]+)\.(?:webp|jpg|png)$/;

/**
 * Smaller alternatives of an i.ytimg artwork, largest first, **JPEG only**.
 *
 * `maxresdefault` does not exist for every upload, so a tile that fails to
 * paint walks down this list (`maxresdefault.jpg` → `hq720.jpg` → …)
 * instead of leaving an empty box behind.
 *
 * @param {string} url artwork URL
 * @returns {string[]} candidate URLs, never containing *url* itself
 */
export function artworkFallbacks(url) {
  const match = YTIMG_RE.exec(url || '');
  if (!match) return [];
  const [, videoId, size] = match;
  const start = YTIMG_SIZES.indexOf(size);
  const out = [];
  for (const candidate of YTIMG_SIZES.slice(start < 0 ? 0 : start)) {
    out.push(`https://i.ytimg.com/vi/${videoId}/${candidate}.jpg`);
  }
  return [...new Set(out)].filter((candidate) => candidate !== url);
}

const RETRY_DELAY_MS = 500;
const RETRY_BACKOFF_MS = [1500, 4000];
const MAX_ATTEMPTS = 1 + RETRY_BACKOFF_MS.length;

const ready = new Set();
const failed = new Set();
const inFlight = new Map();

let queue = [];
let pumping = false;
let lastStart = 0;

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** True when this url already loaded successfully during this session. */
export function isArtworkReady(url) {
  return Boolean(url) && ready.has(url);
}

/* ------------------------------------------------------------------ *
 * Persistent byte store (Cache Storage) + object URLs for painting.
 * ------------------------------------------------------------------ */

const CACHE_NAME = 'carmen-artwork-v1';
/** Covers kept on disk; the oldest are dropped past this. */
const MAX_CACHED_ARTWORK = 400;
const TRIM_EVERY = 25;

let cachePromise;
let writesSinceTrim = 0;

/** Opens the cache once; `null` means "not available here". */
function artworkCache() {
  if (cachePromise === undefined) {
    cachePromise =
      typeof caches !== 'undefined'
        ? caches.open(CACHE_NAME).catch(() => null)
        : Promise.resolve(null);
  }
  return cachePromise;
}

/** Stored bytes for *url*, or `null` when there is nothing usable. */
async function readStored(url) {
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

async function trim(cache) {
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

async function store(url, blob) {
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

/** source url -> `blob:` url already handed to an `<img>`. */
const painted = new Map();

/** Object URL for *url*, created at most once. Falls back to the plain URL. */
function paintWith(url, blob) {
  const existing = painted.get(url);
  if (existing) return existing;
  try {
    const objectUrl = URL.createObjectURL(blob);
    painted.set(url, objectUrl);
    return objectUrl;
  } catch {
    return url;
  }
}

/**
 * Blob URL already prepared for *url*, or `null`.
 *
 * Lets a component paint the cached copy on its very first render instead of
 * showing the source URL and swapping once the blob arrives.
 *
 * @param {string} [url] artwork URL
 * @returns {string|null}
 */
export function paintedArtwork(url) {
  return (url && painted.get(url)) || null;
}

async function request(url) {
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

/** @returns {Promise<Blob|null>} the bytes once they are stored */
async function attempt(url) {
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

async function pump() {
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
 * @param {string} url image URL
 * @returns {Promise<string|null>}
 */
export function loadArtwork(url) {
  if (!url || typeof url !== 'string') return Promise.resolve(null);
  if (ready.has(url)) return Promise.resolve(paintedArtwork(url) || url);
  if (inFlight.has(url)) return inFlight.get(url);

  const promise = (async () => {
    const stored = await readStored(url);
    inFlight.delete(url);
    if (stored) {
      ready.add(url);
      failed.delete(url);
      return paintWith(url, stored);
    }
    return new Promise((resolve) => {
      queue.push({ url, resolve });
      pump();
    });
  })();

  inFlight.set(url, promise);
  return promise;
}

/** Queue an artwork download without waiting for it. */
export function warmArtwork(url) {
  loadArtwork(url);
}

/**
 * Average color of an artwork, used to tint the ambient background.
 *
 * Reads the stored copy first — the `<img>` already pulled those bytes — so
 * this rarely costs a network request.  Returns `null` when the CDN does not
 * allow reading the pixels.
 *
 * @param {string} url image URL
 * @returns {Promise<string|null>} `#rrggbb`
 */
export async function extractColor(url) {
  if (!url) return null;
  try {
    let blob = await readStored(url);
    if (!blob) {
      const response = await fetch(url, { mode: 'cors', cache: 'force-cache' });
      if (!response.ok) return null;
      blob = await response.blob();
      store(url, blob);
    }
    const bitmap = await createImageBitmap(blob);
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
    const toHex = (channel) =>
      Math.max(0, Math.min(255, Math.round(channel / weight)))
        .toString(16)
        .padStart(2, '0');
    return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
  } catch {
    return null;
  }
}
