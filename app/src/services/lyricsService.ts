/**
 * Lyrics helpers shared by the player's lyrics panel and the download
 * pipeline, so what is on screen and what lands in the file are the same
 * text.
 *
 * Port of frontend/src/utils/lyrics.js plus the new `parseLrc` reader used
 * for offline `.lrc` files.
 */

/** One timestamped lyric line. */
export interface LyricLine {
  timeMs: number;
  text: string;
}

/**
 * Format `[{ timeMs, text }]` as LRC — one `[mm:ss.cc]text` line per entry.
 *
 * This is the plain text dialect every player understands (and the exact
 * format the app's own lyrics view parses), which is why the download writes
 * it into the tags and the "Download Lyrics" action saves it as a file.
 */
export function toLrc(lines: LyricLine[]): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
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

/**
 * Read an `.lrc` document into `[{ timeMs, text }]`.
 *
 * Accepts `[mm:ss]`, `[mm:ss.x]`, `[mm:ss.xx]` and `[mm:ss.xxx]` stamps —
 * the fractional part is read as a fraction of a second (centis are padded,
 * millis are exact). Metadata lines such as `[ar:Artist]` or `[offset:500]`
 * never match the timestamp shape and are ignored; anything unusable yields
 * `[]` rather than throwing.
 */
export function parseLrc(text: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const match = /^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\](.*)$/.exec(raw);
    if (!match) continue;
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    const fractionMs = match[3] === undefined ? 0 : Number(match[3].padEnd(3, '0'));
    out.push({
      timeMs: minutes * 60000 + seconds * 1000 + fractionMs,
      text: match[4],
    });
  }
  return out;
}

interface MetaShape {
  lyrics?: { synced?: unknown; unsynced?: unknown };
}

/** Timestamped lines of a track payload, or `null` when there are none. */
export function syncedLines(meta: unknown): LyricLine[] | null {
  const lines = (meta as MetaShape | null | undefined)?.lyrics?.synced;
  return Array.isArray(lines) && lines.length ? (lines as LyricLine[]) : null;
}

/** The plain unsynced text of a track payload, or `null`. */
export function plainLyrics(meta: unknown): string | null {
  const text = (meta as MetaShape | null | undefined)?.lyrics?.unsynced;
  return typeof text === 'string' && text.trim() ? text : null;
}
