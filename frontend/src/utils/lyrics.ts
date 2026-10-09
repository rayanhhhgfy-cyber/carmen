/**
 * Lyrics helpers shared by the player's lyrics panel and the download
 * pipeline, so what is on screen and what lands in the file are the same
 * text.
 */
import type { LyricLine, TrackLyrics, TrackMeta } from '../types/models';

/**
 * Format `[{ timeMs, text }]` as LRC — one `[mm:ss.cc]text` line per entry.
 *
 * This is the plain text dialect every player understands (and the exact
 * format the app's own lyrics view parses), which is why the download stores
 * it as `lyrics.lrc` next to the audio.
 */
export function toLrc(lines: LyricLine[] | null | undefined): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (Array.isArray(lines) ? lines : [])
    .map((line) => {
      const ms = Math.max(0, Number(line?.timeMs) || 0);
      const minutes = Math.floor(ms / 60000);
      const seconds = Math.floor(ms / 1000) % 60;
      const centis = Math.floor(ms / 10) % 100;
      return `[${pad(minutes)}:${pad(seconds)}.${pad(centis)}]${String(line?.text ?? '')}`;
    })
    .join('\n');
}

/** Parse an `.lrc` document into timed lines (used for offline lyrics). */
export function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const pattern = /^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\](.*)$/;
  for (const raw of text.split(/\r?\n/)) {
    const match = pattern.exec(raw.trim());
    if (!match) continue;
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    const fraction = match[3] ?? '0';
    const ms =
      minutes * 60000 +
      seconds * 1000 +
      Number(fraction.padEnd(3, '0').slice(0, 3));
    lines.push({ timeMs: ms, text: (match[4] ?? '').trim() });
  }
  return lines;
}

/** Timestamped lines of a track payload, or `null` when there are none. */
export function syncedLines(meta: TrackMeta | null | undefined): LyricLine[] | null {
  const lines = meta?.lyrics?.synced;
  return Array.isArray(lines) && lines.length ? lines : null;
}

/** The plain unsynced text of a track payload, or `null`. */
export function plainLyrics(meta: TrackMeta | null | undefined): string | null {
  const text = meta?.lyrics?.unsynced;
  return typeof text === 'string' && text.trim() ? text : null;
}

/** Lyrics container with a defensive default — used all over the UI. */
export function lyricsOf(meta: TrackMeta | null | undefined): TrackLyrics {
  return meta?.lyrics ?? { synced: null, unsynced: null, source: null };
}

/**
 * Index of the last line whose timestamp has passed — a binary search, so
 * every playhead tick costs `O(log n)` and nothing else.
 *
 * Shared by the lyrics panel and the lock-screen lyric mirror
 * (`services/mediaSession/lockScreenLyrics`) so both highlight exactly the
 * same line at exactly the same millisecond.
 *
 * @returns `-1` before the first line (intro, ads, instrumental leads)
 */
export function activeLineIndexAt(lines: LyricLine[], timeMs: number): number {
  let low = 0;
  let high = lines.length - 1;
  let answer = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (lines[middle].timeMs <= timeMs) {
      answer = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return answer;
}
