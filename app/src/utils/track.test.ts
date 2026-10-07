import {
  albumName,
  artistNames,
  cdnArtwork,
  normalizeList,
  normalizeTrack,
  pickArtwork,
} from './track';

test('normalizeTrack shapes a raw API track', () => {
  expect(
    normalizeTrack({ videoId: 'abc', title: 'T', artists: [{ name: 'A' }], duration: '3:05' }),
  ).toEqual({
    videoId: 'abc',
    title: 'T',
    artists: [{ name: 'A' }],
    artist: 'A',
    album: null,
    albumName: '',
    duration: '3:05',
    durationSeconds: 185,
    artwork: 'https://i.ytimg.com/vi/abc/maxresdefault.jpg',
    year: null,
    isExplicit: false,
    playlistId: null,
  });
});

test('normalizeTrack returns null for unusable input', () => {
  expect(normalizeTrack({})).toBeNull();
  expect(normalizeTrack(null)).toBeNull();
  expect(normalizeTrack('abc')).toBeNull();
  expect(normalizeTrack({ title: 'no id' })).toBeNull();
});

test('normalizeList drops unusable entries', () => {
  const list = normalizeList([{ videoId: 'abc', title: 'T' }, {}, null]);
  expect(list).toHaveLength(1);
  expect(list[0].videoId).toBe('abc');
});

test('artistNames / albumName join display strings', () => {
  expect(artistNames([{ name: 'A' }, { name: 'B' }])).toBe('A, B');
  expect(artistNames('Solo')).toBe('Solo');
  expect(artistNames(null)).toBe('');
  expect(albumName({ name: 'LP' })).toBe('LP');
  expect(albumName(null)).toBe('');
});

test('cdnArtwork always serves JPEG from the i.ytimg CDN', () => {
  expect(cdnArtwork('abc')).toBe('https://i.ytimg.com/vi/abc/maxresdefault.jpg');
  expect(cdnArtwork('')).toBeNull();
  expect(cdnArtwork(undefined)).toBeNull();
});

test('pickArtwork prefers JPEG over WebP and the largest size', () => {
  const thumbs = [
    { url: 'https://img/small.jpg', width: 120, height: 90 },
    { url: 'https://img/big.jpg', width: 640, height: 480 },
    { url: 'https://img/huge.webp', width: 1280, height: 720 },
  ];
  expect(pickArtwork(thumbs)).toBe('https://img/big.jpg');
  expect(pickArtwork([{ url: 'https://img/only.webp' }])).toBe('https://img/only.webp');
  expect(pickArtwork('https://plain.jpg')).toBe('https://plain.jpg');
  expect(pickArtwork()).toBeNull();
});
