import { useSyncExternalStore } from 'react';
import { normalizeTrack } from './track';

/**
 * Client side "home" library, persisted in localStorage:
 *
 *  - **recent**: the last 10 songs the client played.
 *  - **suggestions**: songs harvested from the related list of every song the
 *    client plays (10 per play), shuffled on the home page, capped at 100.
 *    When the pool is full the oldest entries are dropped (FIFO).
 *
 * Both lists are updated by the player as songs start, so the home page can
 * render a personal feed without any backend storage.
 */

export const RECENT_LIMIT = 10;
export const SUGGESTION_LIMIT = 100;
export const SUGGESTION_BATCH = 10;

const RECENT_KEY = 'samma3ni.recent.v1';
const SUGGESTIONS_KEY = 'samma3ni.suggestions.v1';

const listeners = new Set();

let snapshot = null;

function readList(key) {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => entry && typeof entry.videoId === 'string');
  } catch {
    /* corrupted or unavailable storage -> start empty */
    return [];
  }
}

function writeList(key, list) {
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* quota exceeded / private mode: keep the in-memory copy only */
  }
}

function loadSnapshot() {
  return { recent: readList(RECENT_KEY), suggestions: readList(SUGGESTIONS_KEY) };
}

export function getLibrarySnapshot() {
  if (!snapshot) snapshot = loadSnapshot();
  return snapshot;
}

function emit(next) {
  snapshot = next;
  writeList(RECENT_KEY, next.recent);
  writeList(SUGGESTIONS_KEY, next.suggestions);
  listeners.forEach((listener) => listener());
}

export function subscribeLibrary(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Keep other tabs in sync.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === RECENT_KEY || event.key === SUGGESTIONS_KEY || event.key === null) {
      snapshot = loadSnapshot();
      listeners.forEach((listener) => listener());
    }
  });
}

/** Fisher-Yates shuffle returning a new array. */
export function shuffleList(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function dedupe(list) {
  const seen = new Set();
  const result = [];
  list.forEach((entry) => {
    if (!entry || seen.has(entry.videoId)) return;
    seen.add(entry.videoId);
    result.push(entry);
  });
  return result;
}

/**
 * Remember a played song: it moves to the front of the recent list (max 10)
 * and leaves the suggestion pool so the home page never repeats itself.
 */
export function recordPlay(rawTrack) {
  const track = normalizeTrack(rawTrack);
  if (!track) return getLibrarySnapshot();

  const current = getLibrarySnapshot();
  const recent = dedupe([track, ...current.recent]).slice(0, RECENT_LIMIT);
  const suggestions = current.suggestions.filter(
    (entry) => entry.videoId !== track.videoId,
  );

  emit({ recent, suggestions });
  return getLibrarySnapshot();
}

/**
 * Add up to :data:`SUGGESTION_BATCH` songs taken from the related list of the
 * song that just started playing.  Newest first; the pool is trimmed back to
 * :data:`SUGGESTION_LIMIT`, dropping the oldest entries.
 */
export function addSuggestions(rawTracks) {
  const batch = (Array.isArray(rawTracks) ? rawTracks : [])
    .map((entry) => normalizeTrack(entry))
    .filter(Boolean)
    .slice(0, SUGGESTION_BATCH);

  if (!batch.length) return getLibrarySnapshot();

  const current = getLibrarySnapshot();
  const recentIds = new Set(current.recent.map((entry) => entry.videoId));
  const batchIds = new Set(batch.map((entry) => entry.videoId));

  const fresh = batch.filter((entry) => !recentIds.has(entry.videoId));
  const kept = current.suggestions.filter(
    (entry) => !batchIds.has(entry.videoId) && !recentIds.has(entry.videoId),
  );

  const suggestions = dedupe([...fresh, ...kept]).slice(0, SUGGESTION_LIMIT);
  emit({ recent: current.recent, suggestions });
  return getLibrarySnapshot();
}

/** Wipe the locally cached history and suggestions. */
export function clearLibrary() {
  emit({ recent: [], suggestions: [] });
  return getLibrarySnapshot();
}

/** Reactive view of the persisted library (updates across components/tabs). */
export function useLibrary() {
  return useSyncExternalStore(subscribeLibrary, getLibrarySnapshot, getLibrarySnapshot);
}
