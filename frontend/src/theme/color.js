/**
 * Adaptive accent maths: turning the pixels of a cover into one hex colour.
 *
 * Deliberately free of any DOM (no `Image`, no canvas) — `adaptiveAccent.js`
 * owns loading the artwork and painting it on a canvas, and hands the raw
 * RGBA samples over here.  Keeping the decision in a plain module is what
 * makes it possible to check a real cover against it from a script.
 *
 * The rules, in order:
 *
 *  1. **Only the 1:1 cover counts.**  The sampler hands over the square the
 *     UI draws (`object-fit: cover` on a square), never the whole 16:9 video
 *     frame — a widescreen still brings its letterboxing and its set design
 *     along, and neither belongs to the record.
 *  2. **A cover that carries no colour is black → white.**  Nothing would be
 *     readable of a black accent on the dark theme, so a cover made of black
 *     and grey shades answers white instead.
 *  3. **The record's hue wins, not its shadows.**  Coloured pixels are
 *     tallied by hue sector, each sector weighted by how much area *and* how
 *     much colour it carries — so a red that spreads over a hundred noisy
 *     buckets still beats the single black jacket standing in front of it,
 *     and one bright logo cannot out-shout the colour of the cover itself.
 *  4. **An accent has to be visible.**  A winner that is nearly black is
 *     lifted to a readable lightness and one that is barely tinted stays
 *     white; a pastel winner — readable but washed out — is pulled down to a
 *     lightness the light theme can still show, keeping its hue either way.
 */

/** Bytes per pixel of the RGBA buffer. */
const BYTES = 4;

/** Pixels at or above this alpha are cover; below it is background. */
const MIN_ALPHA = 200;

/**
 * `max - min` channel spread at which a pixel counts as *coloured* rather
 * than a shade of grey.  24/255 sits just above "black with a tint", which
 * is exactly what the shadows of a dark cover look like.
 */
const CHROMA_MIN = 24;

/** Below this share of coloured pixels the cover reads as black or grey. */
const COLORFUL_MIN = 0.12;

/** Bucket granularity: the top 4 bits of each channel → 4096 buckets. */
const BUCKET_SHIFT = 4;

/** Hue is tallied in sectors of this many degrees (12 in a full turn). */
const HUE_SECTOR_DEGREES = 30;

/** Weight of the pixel count against the weight of the colour in the score. */
const MASS_FLOOR = 0.2;

/** A winner darker than this lightness is not readable as an accent. */
const MIN_LIGHTNESS = 0.34;

/** A winner greyer than this is a shade of grey, not a colour. */
const MIN_SATURATION = 0.16;

/** Dark covers are lifted here (lightness) with at least this saturation. */
const LIFTED_LIGHTNESS = 0.55;
const LIFTED_SATURATION = 0.5;

/**
 * Pale covers are pulled down to this lightness instead, so a pastel record
 * cannot hand the theme an accent the light theme is unable to read.
 */
const MAX_LIGHTNESS = 0.6;

/** What a cover with no colour in it answers. */
const NEUTRAL_ACCENT = '#FFFFFF';

function chroma(r, g, b) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/** sRGB → HSL.  Returns `[h (0-360), s (0-1), l (0-1)]`. */
export function rgbToHsl(r, g, b) {
  // Normalise first: every term below has to be in the same 0-1 scale,
  // otherwise the hue sectors land on the wrong colour.
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) return [0, 0, lightness];

  const saturation =
    delta / (lightness > 0.5 ? 2 - max - min : max + min);
  let hue;
  if (max === rn) hue = ((gn - bn) / delta) % 6;
  else if (max === gn) hue = (bn - rn) / delta + 2;
  else hue = (rn - gn) / delta + 4;

  return [(hue * 60 + 360) % 360, saturation, lightness];
}

/** HSL → sRGB bytes. */
export function hslToRgb(hue, saturation, lightness) {
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = ((hue % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((sector % 2) - 1));
  const [r, g, b] =
    sector < 1 ? [c, x, 0] :
    sector < 2 ? [x, c, 0] :
    sector < 3 ? [0, c, x] :
    sector < 4 ? [0, x, c] :
    sector < 5 ? [x, 0, c] :
    [c, 0, x];
  const m = lightness - c / 2;
  const toByte = (value) => Math.round((value + m) * 255);
  return [toByte(r), toByte(g), toByte(b)];
}

export function toHex(r, g, b) {
  const part = (value) =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

/**
 * The accent to paint the theme with, from RGBA samples of the 1:1 cover.
 *
 * @param {Uint8ClampedArray|Uint8Array} data RGBA bytes (any size — the
 *   caller decides the sampling resolution)
 * @returns {string|null} `#RRGGBB`, or `null` when there is nothing to read
 */
export function pickAccentColor(data) {
  const buckets = new Map();
  let total = 0;
  let colored = 0;

  for (let index = 0; index + BYTES <= data.length; index += BYTES) {
    if (data[index + 3] < MIN_ALPHA) continue;

    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    total += 1;
    if (chroma(r, g, b) >= CHROMA_MIN) colored += 1;

    const key =
      (r >> BUCKET_SHIFT) * 256 + (g >> BUCKET_SHIFT) * 16 + (b >> BUCKET_SHIFT);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }

  if (!total) return null;

  // Rule 2: black / grey cover → white.
  if (colored / total < COLORFUL_MIN) return NEUTRAL_ACCENT;

  // Rule 3: tally the coloured buckets by hue sector.  Shadows (chroma below
  // CHROMA_MIN) cast no vote at all — they are lighting, not the colour of
  // the record — and grouping by hue keeps a textured or JPEG-noisy colour
  // from being counted as a dozen separate small ones.
  const sectors = new Map();
  buckets.forEach((bucket) => {
    const r = bucket.r / bucket.count;
    const g = bucket.g / bucket.count;
    const b = bucket.b / bucket.count;
    const spread = chroma(r, g, b);
    if (spread < CHROMA_MIN) return;

    const score = bucket.count * (MASS_FLOOR + spread / 255);
    const hue = rgbToHsl(r, g, b)[0];
    const key = Math.floor(hue / HUE_SECTOR_DEGREES);
    const sector = sectors.get(key);
    if (!sector) {
      sectors.set(key, { score, winner: { r, g, b }, winnerScore: score });
    } else {
      sector.score += score;
      // The sector's own colour is its strongest voice, not its biggest —
      // the deepest shadow of a red wall is not the red of it.
      if (score > sector.winnerScore) {
        sector.winnerScore = score;
        sector.winner = { r, g, b };
      }
    }
  });

  if (!sectors.size) return NEUTRAL_ACCENT;

  let winner = null;
  let bestScore = -1;
  sectors.forEach((sector) => {
    if (sector.score > bestScore) {
      bestScore = sector.score;
      winner = sector.winner;
    }
  });
  if (!winner) return null;

  // Rule 4: readable, and still the cover's own colour.
  const [hue, saturation, lightness] = rgbToHsl(winner.r, winner.g, winner.b);
  if (lightness < MIN_LIGHTNESS) {
    if (saturation < MIN_SATURATION) return NEUTRAL_ACCENT;
    const lifted = hslToRgb(hue, Math.max(saturation, LIFTED_SATURATION), LIFTED_LIGHTNESS);
    return toHex(...lifted);
  }
  if (lightness > MAX_LIGHTNESS) {
    if (saturation < MIN_SATURATION) return NEUTRAL_ACCENT;
    return toHex(...hslToRgb(hue, saturation, MAX_LIGHTNESS));
  }

  return toHex(winner.r, winner.g, winner.b);
}
