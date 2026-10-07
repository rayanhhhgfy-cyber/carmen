import { decode as decodeJpeg } from 'jpeg-js';
import { decode as decodePng, type DecodedPng } from 'fast-png';

/**
 * Adaptive accent colour: the accent follows the cover of whatever is
 * playing.
 *
 * This is the cross-platform port of `frontend/src/theme/adaptiveAccent.js`.
 * That module owns the DOM bits — loading the artwork and painting it on a
 * canvas at 48×48 — and hands the raw RGBA samples to `color.js`, whose
 * `pickAccentColor` decides what the pixels *are*.  There is no canvas here,
 * so this module decodes the bytes itself (`fast-png` / `jpeg-js`, both pure
 * JS → run everywhere), samples them down and runs the very same decision
 * rules.  The rules and their thresholds come from the web source verbatim —
 * behavioural parity with the web app outranks the plan's indicative numbers:
 *
 *  - A cover that carries no colour is black → white (`COLORFUL_MIN`,
 *    `CHROMA_MIN`) — nothing would be readable of a black accent on the dark
 *    theme, so a cover made of black and grey shades answers `#FFFFFF`.
 *  - The record's hue wins, not its shadows: buckets (top 4 bits per
 *    channel, exactly as the plan prescribes) are tallied by 30° hue
 *    sector, each weighted by area *and* chroma.
 *  - An accent has to be visible: a winner darker than `MIN_LIGHTNESS` is
 *    lifted, a pastel one is pulled down to `MAX_LIGHTNESS`, a grey one
 *    stays white (`MIN_SATURATION`).
 *  - Nothing readable at all (fully transparent, or undecodable bytes) →
 *    `null`: the chosen accent simply stays in place, as on the web.
 *
 * Where the plan's indicative numbers (saturation ≥ 0.35, luminance in
 * [0.15, 0.85]) differ from `frontend/src/theme/color.js`, the web source
 * wins: chroma ≥ 24 / colourful ≥ 12 % gate the cover, `MIN_LIGHTNESS` 0.34
 * and `MAX_LIGHTNESS` 0.6 bound the winner, `MIN_SATURATION` 0.16 keeps
 * shades of grey out.
 *
 * Two sampling deviations from the web, neither of which changes the rules:
 * the whole cover is stride-sampled to ≤ 256×256 instead of the centre
 * 1:1 crop at 48×48 (the web crops what its `object-fit: cover` square
 * draws; there is no such square to mirror yet), and there is no per-URL
 * cache — callers can add one when artwork loading lands.
 */

/** PNG signature: 89 50 4E 47 0D 0A 1A 0A. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** JPEG: SOI marker FF D8, then another marker byte. */
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

/** Artwork is sampled to at most this many pixels per side. */
const MAX_SAMPLE_SIDE = 256;

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

interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

function matchesSignature(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) return false;
  }
  return true;
}

/**
 * fast-png hands back the file's own layout — 1–4 channels at 1/2/4/8/16
 * bits, palettes included.  Normalise everything to 8-bit RGBA, or answer
 * `null` for a shape we cannot read.
 */
function pngToRgba(decoded: DecodedPng): RgbaImage | null {
  const { width, height, data, depth, channels, palette } = decoded;
  if (!width || !height || !channels || channels < 1 || channels > 4) return null;
  if (depth !== 1 && depth !== 2 && depth !== 4 && depth !== 8 && depth !== 16) return null;

  const words = data instanceof Uint16Array ? data : null;
  const bytes =
    data instanceof Uint16Array
      ? null
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (!words && !bytes) return null;

  // Indexed colour: one sample per pixel, looked up in the palette (which
  // carries the tRNS alphas when the PNG had them).
  if (palette) {
    if (channels !== 1) return null;
    const out = new Uint8Array(width * height * 4);
    for (let p = 0; p < width * height; p++) {
      const entry = palette[rawSample(p)] ?? [];
      const at = p * 4;
      out[at] = entry[0] ?? 0;
      out[at + 1] = entry[1] ?? 0;
      out[at + 2] = entry[2] ?? 0;
      out[at + 3] = entry.length > 3 ? entry[3] : 255;
    }
    return { width, height, data: out };
  }

  const out = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const at = p * 4;
    if (channels === 1) {
      const gray = sample(p);
      out[at] = gray;
      out[at + 1] = gray;
      out[at + 2] = gray;
      out[at + 3] = 255;
    } else if (channels === 2) {
      const gray = sample(p * 2);
      out[at] = gray;
      out[at + 1] = gray;
      out[at + 2] = gray;
      out[at + 3] = sample(p * 2 + 1);
    } else if (channels === 3) {
      out[at] = sample(p * 3);
      out[at + 1] = sample(p * 3 + 1);
      out[at + 2] = sample(p * 3 + 2);
      out[at + 3] = 255;
    } else {
      out[at] = sample(p * 4);
      out[at + 1] = sample(p * 4 + 1);
      out[at + 2] = sample(p * 4 + 2);
      out[at + 3] = sample(p * 4 + 3);
    }
  }
  return { width, height, data: out };

  /** One channel as stored: 16-bit words, 8-bit bytes, sub-byte packs. */
  function rawSample(index: number): number {
    if (words) return words[index];
    if (depth === 8) return bytes![index];
    // Sub-byte depths pack samples MSB-first within each byte.
    const bit = index * depth;
    const shift = 8 - depth - (bit & 7);
    const mask = (1 << depth) - 1;
    return (bytes![bit >> 3] >> shift) & mask;
  }

  /** One channel scaled to a byte (16-bit keeps the high byte). */
  function sample(index: number): number {
    if (words) return rawSample(index) >> 8;
    if (depth === 8) return rawSample(index);
    const max = (1 << depth) - 1;
    return Math.round((rawSample(index) * 255) / max);
  }
}

/** Decode by magic bytes; anything unreadable answers `null`. */
function decodeImage(bytes: Uint8Array): RgbaImage | null {
  if (matchesSignature(bytes, PNG_SIGNATURE)) {
    try {
      return pngToRgba(decodePng(bytes));
    } catch {
      return null; // truncated or otherwise broken PNG
    }
  }
  if (matchesSignature(bytes, JPEG_SIGNATURE)) {
    try {
      // `useTArray` keeps the answer a Uint8Array — no Buffer on Hermes.
      const image = decodeJpeg(bytes, { useTArray: true, formatAsRGBA: true });
      if (!image.width || !image.height) return null;
      return { width: image.width, height: image.height, data: image.data };
    } catch {
      return null;
    }
  }
  return null; // neither PNG nor JPEG
}

/** Stride-sample so at most ~256×256 pixels reach the decision below. */
function strideSample(image: RgbaImage): Uint8Array {
  const { width, height, data } = image;
  const stepX = Math.max(1, Math.ceil(width / MAX_SAMPLE_SIDE));
  const stepY = Math.max(1, Math.ceil(height / MAX_SAMPLE_SIDE));
  if (stepX === 1 && stepY === 1) return data;

  const out = new Uint8Array(Math.ceil(width / stepX) * Math.ceil(height / stepY) * 4);
  let at = 0;
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const src = (y * width + x) * 4;
      out[at] = data[src];
      out[at + 1] = data[src + 1];
      out[at + 2] = data[src + 2];
      out[at + 3] = data[src + 3];
      at += 4;
    }
  }
  return out;
}

/**
 * The dominant colour of an artwork, from its raw bytes.
 *
 * @param bytes a PNG or a JPEG, straight off the network
 * @returns `#RRGGBB` (white when the cover carries no colour), or `null`
 *   when the bytes cannot be decoded or hold no readable pixel — the chosen
 *   accent then simply stays in place
 */
export function dominantColor(bytes: Uint8Array): string | null {
  const image = decodeImage(bytes);
  if (!image) return null;
  return pickAccentColor(strideSample(image));
}

function chroma(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/** sRGB → HSL.  Returns `[h (0-360), s (0-1), l (0-1)]`. */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
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

  const saturation = delta / (lightness > 0.5 ? 2 - max - min : max + min);
  let hue: number;
  if (max === rn) hue = ((gn - bn) / delta) % 6;
  else if (max === gn) hue = (bn - rn) / delta + 2;
  else hue = (rn - gn) / delta + 4;

  return [((hue * 60 + 360) % 360), saturation, lightness];
}

/** HSL → sRGB bytes. */
function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = ((((hue % 360) + 360) % 360) / 60);
  const x = c * (1 - Math.abs((sector % 2) - 1));
  const [r, g, b] =
    sector < 1 ? [c, x, 0] :
    sector < 2 ? [x, c, 0] :
    sector < 3 ? [0, c, x] :
    sector < 4 ? [0, x, c] :
    sector < 5 ? [x, 0, c] :
    [c, 0, x];
  const m = lightness - c / 2;
  const toByte = (value: number) => Math.round((value + m) * 255);
  return [toByte(r), toByte(g), toByte(b)];
}

function toHex(r: number, g: number, b: number): string {
  const part = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

/**
 * The accent to paint the theme with, from RGBA samples — a direct port of
 * `frontend/src/theme/color.js` (`pickAccentColor`), thresholds and all.
 *
 * @param data RGBA bytes (any size — the caller decides the sampling)
 * @returns `#RRGGBB`, or `null` when there is nothing to read
 */
export function pickAccentColor(data: Uint8Array): string | null {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
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

  // Black / grey cover → white.
  if (colored / total < COLORFUL_MIN) return NEUTRAL_ACCENT;

  // Tally the coloured buckets by hue sector.  Shadows (chroma below
  // CHROMA_MIN) cast no vote at all — they are lighting, not the colour of
  // the record — and grouping by hue keeps a textured or JPEG-noisy colour
  // from being counted as a dozen separate small ones.
  const sectors = new Map<
    number,
    { score: number; winner: { r: number; g: number; b: number }; winnerScore: number }
  >();
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

  let winner: { r: number; g: number; b: number } | null = null;
  let bestScore = -1;
  // for...of (not forEach): TypeScript's control-flow analysis tracks
  // assignments made in plain loops but not in callbacks, and the guard
  // below would otherwise narrow `winner` to `never`.
  for (const sector of sectors.values()) {
    if (sector.score > bestScore) {
      bestScore = sector.score;
      winner = sector.winner;
    }
  }
  if (!winner) return null;

  // Readable, and still the cover's own colour.
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
