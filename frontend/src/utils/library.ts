/**
 * Home feed store — "recently played" + "suggested for you".
 *
 * The API surface is unchanged from the original localStorage implementation;
 * the data now lives in SQLite (`feed_recent` / `feed_suggestions`) and is
 * hydrated once during bootstrap. Writes are optimistic in memory and
 * persisted in the background.
 */
import { useSyncExternalStore } from 'react';

import * as feed from '../db/repos/feed';
import type { Track } from '../types/models';

export const RECENT_LIMIT = feed.RECENT_LIMIT;
export const SUGGESTION_LIMIT = feed.SUGGESTION_LIMIT;
export const SUGGESTION_BATCH = feed.SUGGESTION_BATCH;

export interface LibrarySnapshot {
  recent: Track[];
  suggestions: Track[];
}

let snapshot: LibrarySnapshot = { recent: [], suggestions: [] };
let hydrated = false;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

/** Loads the feed from SQLite — awaited during bootstrap (see `main.tsx`). */
export async function hydrateLibrary(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    snapshot = await feed.getFeed();
  } catch (error) {
    console.warn('[library] hydrate failed', error);
  }
  notify();
}

export function getLibrarySnapshot(): LibrarySnapshot {
  return snapshot;
}

export function subscribeLibrary(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Fisher-Yates shuffle returning a new array. */
export function shuffleList<T>(list: T[]): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** A song that starts playing moves to the front of "recently played". */
export function recordPlay(track: Track): void {
  snapshot = {
    recent: [track, ...snapshot.recent.filter((entry) => entry.videoId !== track.videoId)].slice(
      0,
      RECENT_LIMIT,
    ),
    suggestions: snapshot.suggestions.filter((entry) => entry.videoId !== track.videoId),
  };
  notify();
  void feed.recordPlay(track).catch((error) => console.warn('[library] recordPlay failed', error));
}

/** Harvests related songs into the suggestion pool (FIFO, deduped). */
export function addSuggestions(tracks: Track[]): void {
  if (!tracks.length) return;
  const known = new Set([
    ...snapshot.recent.map((track) => track.videoId),
    ...snapshot.suggestions.map((track) => track.videoId),
  ]);
  const added = tracks.filter((track) => !known.has(track.videoId));
  if (!added.length) return;
  snapshot = {
    ...snapshot,
    suggestions: [...added, ...snapshot.suggestions].slice(0, SUGGESTION_LIMIT),
  };
  notify();
  void feed.addSuggestions(tracks).catch((error) => console.warn('[library] suggestions failed', error));
}

export function clearLibrary(): void {
  snapshot = { recent: [], suggestions: [] };
  notify();
  void feed.clearFeed().catch(() => {});
}

/** Live view of the feed. */
export function useLibrary(): LibrarySnapshot {
  return useSyncExternalStore(subscribeLibrary, getLibrarySnapshot, getLibrarySnapshot);
}
