/**
 * Lyrics helpers shared by the player's lyrics panel and the download
 * pipeline, so what is on screen and what lands in the file are the same
 * text.
 */

/**
 * Format `[{ timeMs, text }]` as LRC — one `[mm:ss.cc]text` line per entry.
 *
 * This is the plain text dialect every player understands (and the exact
 * format the app's own lyrics view parses), which is why the download writes
 * it into the tags and the "Download Lyrics" action saves it as a file.
 *
 * @param {Array<{timeMs?: number, text?: string}>} lines
 * @returns {string}
 */
export function toLrc(lines) {
  const pad = (value) => String(value).padStart(2, '0');
  return (Array.isArray(lines) ? lines : [])
    .map((line) => {
      const ms = Math.max(0, Number(line?.timeMs) || 0);
      const minutes = Math.floor(ms / 60000);
      const seconds = Math.floor(ms / 1000) % 60;
      const centis = Math.floor(ms / 10) % 100;
      return `[${pad(minutes)}:${pad(seconds)}.${pad(centis)}]${String(
        line?.text ?? '',
      )}`;
    })
    .join('\n');
}

/** Timestamped lines of a track payload, or `null` when there are none. */
export function syncedLines(meta) {
  const lines = meta?.lyrics?.synced;
  return Array.isArray(lines) && lines.length ? lines : null;
}

/** The plain unsynced text of a track payload, or `null`. */
export function plainLyrics(meta) {
  const text = meta?.lyrics?.unsynced;
  return typeof text === 'string' && text.trim() ? text : null;
}
