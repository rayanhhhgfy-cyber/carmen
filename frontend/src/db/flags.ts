/**
 * Reactive "flags" store — which songs are **downloaded** and which are
 * **favorites**, as two live id sets.
 *
 * Why not just ask the DB per row? Every list (queue, related, search,
 * library) would need one async query per rendered row and could never
 * re-render when a download finishes or a heart is toggled. Instead the sets
 * are hydrated once at bootstrap (`main.tsx`) and patched synchronously by
 * the mutation sites (`utils/downloads`, `db/repos/favorites`), so any
 * component can read them with `useSyncExternalStore` and update instantly.
 */
import { useSyncExternalStore } from 'react';

export type FlagKind = 'downloaded' | 'favorite';

export interface FlagsSnapshot {
  downloaded: ReadonlySet<string>;
  favorite: ReadonlySet<string>;
}

type Listener = () => void;

const listeners = new Set<Listener>();

let snapshot: FlagsSnapshot = {
  downloaded: new Set(),
  favorite: new Set(),
};

/** Current immutable snapshot (safe to call outside React). */
export function getFlagsSnapshot(): FlagsSnapshot {
  return snapshot;
}

/** Subscribe to flag changes (for `useSyncExternalStore`). */
export function subscribeFlags(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function commit(kind: FlagKind, ids: ReadonlySet<string>): void {
  snapshot = { ...snapshot, [kind]: ids };
  listeners.forEach((listener) => {
    listener();
  });
}

/** Seeds both sets — called once from `main.tsx` after the other hydrations. */
export function hydrateFlags(downloaded: string[], favorites: string[]): void {
  snapshot = {
    downloaded: new Set(downloaded),
    favorite: new Set(favorites),
  };
  listeners.forEach((listener) => {
    listener();
  });
}

/** Adds/removes a single id in one set and notifies subscribers. */
export function setFlag(kind: FlagKind, videoId: string, present: boolean): void {
  if (!videoId) return;
  const current = snapshot[kind];
  if (present === current.has(videoId)) return;
  const next = new Set(current);
  if (present) next.add(videoId);
  else next.delete(videoId);
  commit(kind, next);
}

/** Live flags for the current render. */
export function useFlags(): FlagsSnapshot {
  return useSyncExternalStore(subscribeFlags, getFlagsSnapshot, getFlagsSnapshot);
}

/** Convenience predicate — re-renders the calling component on change. */
export function useFlag(kind: FlagKind, videoId: string | null | undefined): boolean {
  const flags = useFlags();
  return Boolean(videoId) && flags[kind].has(videoId as string);
}
