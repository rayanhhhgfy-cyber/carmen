import { useSyncExternalStore } from 'react';
import { getDownloadsSnapshot, subscribeDownloads } from './utils/downloads';

/** Live view of the browser side download jobs. */
export function useDownloads() {
  return useSyncExternalStore(subscribeDownloads, getDownloadsSnapshot);
}
