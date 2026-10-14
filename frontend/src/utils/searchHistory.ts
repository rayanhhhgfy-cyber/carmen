/**
 * Recent search terms — the Search page's history, capped at the newest
 * five. Plain localStorage (both platforms persist it; unlike the settings
 * store it is data, not a choice, so it stays out of the SQLite KV table).
 */

const KEY = 'carmen:searchHistory';
/** Newest searches kept; older ones fall off the end. */
const MAX = 5;

/** The stored history, newest first. */
export function loadSearchHistory(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
      .slice(0, MAX);
  } catch {
    return [];
  }
}

/** Stores `term` as the newest search (deduped) and returns the new list. */
export function rememberSearch(term: string): string[] {
  const trimmed = term.trim();
  if (!trimmed) return loadSearchHistory();
  const needle = trimmed.toLowerCase();
  const next = [trimmed, ...loadSearchHistory().filter((entry) => entry.toLowerCase() !== needle)].slice(
    0,
    MAX,
  );
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota — the session keeps it in memory anyway */
  }
  return next;
}
