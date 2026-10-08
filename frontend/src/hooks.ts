import { useSyncExternalStore } from 'react';

import {
  getDownloadsSnapshot,
  subscribeDownloads,
  type DownloadsSnapshot,
} from './utils/downloads';

/** Live view of the offline download jobs. */
export function useDownloads(): DownloadsSnapshot {
  return useSyncExternalStore(subscribeDownloads, getDownloadsSnapshot, getDownloadsSnapshot);
}
