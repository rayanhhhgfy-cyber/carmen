import { formatTime, parseDuration, safeFileName } from './format';

test('formatTime', () => {
  expect(formatTime(0)).toBe('0:00');
  expect(formatTime(303)).toBe('5:03');
  expect(formatTime(3723)).toBe('1:02:03');
  expect(formatTime('1:02:03')).toBe('1:02:03');
});

test('parseDuration', () => {
  expect(parseDuration('5:03')).toBe(303);
  expect(parseDuration('1:02:03')).toBe(3723);
  expect(parseDuration('nope')).toBeNull();
  expect(parseDuration(42)).toBe(42);
});

test('safeFileName strips unsafe characters', () => {
  expect(safeFileName('a/b:c*d?e"f<g>h|i')).toBe('a b c d e f g h i');
  expect(safeFileName('')).toBe('track');
});
