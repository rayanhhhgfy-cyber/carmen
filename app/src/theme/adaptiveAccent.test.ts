import { encode as encodeJpeg } from 'jpeg-js';
import { encode as encodePng } from 'fast-png';

import { dominantColor } from './adaptiveAccent';

/** A solid `size × size` RGBA PNG, built the way the plan prescribes. */
function solidPng(size: number, [r, g, b, a]: readonly [number, number, number, number]): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return encodePng({ width: size, height: size, data, depth: 8, channels: 4 });
}

/** The red, green and blue channels of a `#rrggbb` answer. */
function channels(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`not a hex colour: ${hex}`);
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

test('a red cover answers a hex whose dominant channel is red', () => {
  const color = dominantColor(solidPng(8, [255, 0, 0, 255]));
  expect(color).not.toBeNull();
  const [r, g, b] = channels(color as string);
  expect(r).toBeGreaterThan(g);
  expect(r).toBeGreaterThan(b);
  expect(r).toBeGreaterThanOrEqual(0xe0);
  expect(g).toBeLessThanOrEqual(0x30);
  expect(b).toBeLessThanOrEqual(0x30);
});

test('a near-black cover falls back to white (the web app rule)', () => {
  // Nothing would be readable of a black accent on the dark theme — the web
  // app answers #FFFFFF for a cover with no colour in it, and so must we.
  expect(dominantColor(solidPng(8, [4, 4, 4, 255]))).toBe('#FFFFFF');
});

test('a grey cover also falls back to white', () => {
  expect(dominantColor(solidPng(8, [128, 128, 128, 255]))).toBe('#FFFFFF');
});

test('a cover with no readable pixels answers null', () => {
  // Fully transparent: the web app's canvas hands `pickAccentColor` nothing
  // above its alpha floor, which is `null` — the chosen accent stays put.
  expect(dominantColor(solidPng(4, [0, 0, 0, 0]))).toBeNull();
});

test('undecodable bytes answer null', () => {
  expect(dominantColor(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
  // PNG magic, but truncated garbage after it.
  expect(
    dominantColor(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0])),
  ).toBeNull();
});

test('a JPEG cover is decoded and read the same way', () => {
  const data = new Uint8Array(8 * 8 * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;
    data[i + 1] = 0;
    data[i + 2] = 0;
    data[i + 3] = 255;
  }
  const jpeg = encodeJpeg({ width: 8, height: 8, data }, 95);
  const bytes = new Uint8Array(jpeg.data.buffer, jpeg.data.byteOffset, jpeg.data.byteLength);

  const color = dominantColor(bytes);
  expect(color).not.toBeNull();
  const [r, g, b] = channels(color as string);
  expect(r).toBeGreaterThan(g);
  expect(r).toBeGreaterThan(b);
  expect(r).toBeGreaterThanOrEqual(0xd0);
});
