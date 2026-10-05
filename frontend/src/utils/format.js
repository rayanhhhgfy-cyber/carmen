/** Formatting helpers shared across the UI. */

/** Seconds (or "M:SS" / "H:MM:SS") to "M:SS" / "H:MM:SS". */
export function formatTime(value) {
  let seconds = 0;
  if (typeof value === 'number' && Number.isFinite(value)) {
    seconds = Math.max(0, Math.floor(value));
  } else if (typeof value === 'string' && value.includes(':')) {
    seconds = parseDuration(value) ?? 0;
  } else if (typeof value === 'string' && /^\d+$/.test(value)) {
    seconds = Number(value);
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const mm = hours ? String(minutes).padStart(2, '0') : String(minutes);
  const ss = String(rest).padStart(2, '0');
  return hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "5:03" / "1:02:03" to seconds. */
export function parseDuration(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text);
  const parts = text.split(':');
  if (parts.length < 2 || parts.length > 4 || parts.some((p) => !/^\d+$/.test(p.trim()))) {
    return null;
  }
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

/** Strip characters that are unsafe in file names. */
export function safeFileName(name) {
  return (
    String(name || 'track')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'track'
  );
}
