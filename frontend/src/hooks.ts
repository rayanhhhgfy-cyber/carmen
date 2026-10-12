import { useEffect, useState, useSyncExternalStore } from 'react';

import {
  getDownloadsSnapshot,
  subscribeDownloads,
  type DownloadsSnapshot,
} from './utils/downloadsStore';

/** Live view of the offline download jobs. */
export function useDownloads(): DownloadsSnapshot {
  return useSyncExternalStore(subscribeDownloads, getDownloadsSnapshot, getDownloadsSnapshot);
}

/**
 * Live `min-width: 900px` match — the app's `md` step (MUI's
 * `useMediaQuery(theme.breakpoints.up('md'))`, now that Tailwind's `md`
 * carries the same 900px cut). Re-renders on resize, unlike a one-shot check.
 */
const DESKTOP_QUERY = '(min-width: 900px)';

export function useIsDesktop(): boolean {
  const [matches, setMatches] = useState(
    () =>
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia(DESKTOP_QUERY).matches
        : false,
  );
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const query = window.matchMedia(DESKTOP_QUERY);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return matches;
}
