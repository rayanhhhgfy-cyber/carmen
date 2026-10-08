/** Formatting helpers shared across the UI. */

/** Seconds (or "M:SS" / "H:MM:SS") to "M:SS" / "H:MM:SS". */
export function formatTime(value: unknown): string {
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
export function parseDuration(value: unknown): number | null {
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
export function safeFileName(name: string): string {
  return (
    String(name || 'track')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'track'
  );
}

/** Byte counts with a unit — used by the offline library. */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || !Number.isFinite(bytes)) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
