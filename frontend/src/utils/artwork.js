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
 * The bytes land in the normal HTTP cache (the request is a plain `fetch`),
 * which means the `<img>` that eventually displays them paints from cache.
 */

/** Minimum delay between two artwork requests — the CDN rate limit guard. */
export const ARTWORK_GAP_MS = 500;

/** Sizes the i.ytimg CDN exposes for a video, largest first. */
const YTIMG_SIZES = ['maxresdefault', 'hq720', 'sddefault', 'hqdefault'];
const YTIMG_RE = /^https:\/\/i\.ytimg\.com\/(?:vi_webp|vi)\/([\w-]{11})\/([\w-]+)\.(?:webp|jpg|png)$/;

/**
 * Smaller alternatives of an i.ytimg artwork, largest first.
 *
 * `maxresdefault` does not exist for every upload, so a tile that fails to
 * paint walks down this list (`maxresdefault.jpg` → `hq720` → `hqdefault`)
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
    out.push(`https://i.ytimg.com/vi_webp/${videoId}/${candidate}.webp`);
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

async function request(url) {
  try {
    const response = await fetch(url, { mode: 'cors', cache: 'force-cache' });
    if (response.status === 429 || response.status === 503) {
      return 'rate-limited';
    }
    if (!response.ok) return 'failed';
    // read the body so the response is committed to the HTTP cache
    const blob = await response.blob();
    return blob.size > 0 ? 'ok' : 'failed';
  } catch {
    return 'failed';
  }
}

async function attempt(url) {
  for (let index = 0; index < MAX_ATTEMPTS; index += 1) {
    const outcome = await request(url);
    if (outcome === 'ok') return true;
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
  return false;
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

    const ok = await attempt(item.url);
    if (ok) {
      ready.add(item.url);
      failed.delete(item.url);
    } else {
      failed.add(item.url);
    }
    inFlight.delete(item.url);
    item.resolve(ok ? item.url : null);
  }

  pumping = false;
}

/**
 * Queue an artwork download and resolve with its URL once it is cached,
 * or with `null` when it could not be fetched.
 *
 * @param {string} url image URL
 * @returns {Promise<string|null>}
 */
export function loadArtwork(url) {
  if (!url || typeof url !== 'string') return Promise.resolve(null);
  if (ready.has(url)) return Promise.resolve(url);
  if (inFlight.has(url)) return inFlight.get(url);

  const promise = new Promise((resolve) => {
    queue.push({ url, resolve });
  });
  inFlight.set(url, promise);
  pump();
  return promise;
}

/** Queue an artwork download without waiting for it. */
export function warmArtwork(url) {
  loadArtwork(url);
}

/**
 * Average color of an artwork, used to tint the ambient background.
 *
 * The image is fetched through the browser cache (the `<img>` already pulled
 * it), so this rarely costs a network request.  Returns `null` when the CDN
 * does not allow reading the pixels.
 *
 * @param {string} url image URL
 * @returns {Promise<string|null>} `#rrggbb`
 */
export async function extractColor(url) {
  if (!url) return null;
  try {
    const response = await fetch(url, { mode: 'cors', cache: 'force-cache' });
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
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
