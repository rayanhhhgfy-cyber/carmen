import { toLrc, parseLrc, syncedLines, plainLyrics } from './lyricsService';

test('toLrc round-trips through parseLrc', () => {
  const lines = [{ timeMs: 0, text: 'Intro' }, { timeMs: 65_400, text: 'Line two' }];
  const lrc = toLrc(lines);
  expect(lrc).toBe('[00:00.00]Intro\n[01:05.40]Line two');
  expect(parseLrc(lrc)).toEqual(lines);
});

test('parseLrc ignores metadata lines and tolerates bad input', () => {
  expect(parseLrc('[ar:Artist]\n[00:01.00]Hi')).toEqual([{ timeMs: 1000, text: 'Hi' }]);
  expect(parseLrc('garbage')).toEqual([]);
});

test('syncedLines / plainLyrics extract payload fields', () => {
  const meta = { lyrics: { synced: [{ timeMs: 0, text: 'x' }], unsynced: 'hello' } };
  expect(syncedLines(meta)).toHaveLength(1);
  expect(plainLyrics(meta)).toBe('hello');
  expect(syncedLines({})).toBeNull();
  expect(plainLyrics({ lyrics: { unsynced: '  ' } })).toBeNull();
});
