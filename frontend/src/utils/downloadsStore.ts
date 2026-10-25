/**
 * Observable UI state of the offline download pipeline.
 *
 * This tiny store lives in its own module so the heavy download pipeline
 * (`utils/downloads.ts` — fetching audio bytes, cover art, writing files) can
 * be loaded lazily on first download interaction, even though the store below
 * is imported eagerly by Layout, hooks and the share flow. Keeping the two
 * apart is what lets the dynamic import in `main.tsx` actually split the
 * pipeline into its own chunk.
 */

import type { Track } from '../types/models';

export type DownloadStatus = 'running' | 'done' | 'error' | 'skipped';

export interface DownloadJob {
  videoId: string;
  title?: string;
  /** The track, kept so a skipped job can be retried without its row. */
  track?: Track;
  status?: DownloadStatus;
  step?: string;
  progress?: number;
  error?: string;
  /**
   * Still waiting for a queue slot (see the position steps in
   * `utils/downloads.ts`). The smart-downloads status line counts these
   * as queued instead of matching the step text.
   */
  queued?: boolean;
  /** Audio-fetch progress detail, for the speed + ETA label. */
  loadedBytes?: number;
  totalBytes?: number;
  speedBps?: number;
  etaSeconds?: number;
}

export interface DownloadNotice {
  id: number;
  severity: 'success' | 'error' | 'info';
  message: string;
}

export interface DownloadsSnapshot {
  jobs: Record<string, DownloadJob>;
  notice: DownloadNotice | null;
}

const listeners = new Set<() => void>();

let store: DownloadsSnapshot = { jobs: {}, notice: null };
let noticeSeq = 0;

function commit(next: Partial<DownloadsSnapshot>): void {
  store = { ...store, ...next };
  listeners.forEach((listener) => listener());
}

/** Mutators shared with the pipeline in `utils/downloads.ts`. */
export function patchJob(videoId: string, patch: Partial<DownloadJob>): void {
  const job: DownloadJob = store.jobs[videoId] || { videoId };
  commit({ jobs: { ...store.jobs, [videoId]: { ...job, ...patch } } });
}

/** Drops a job entirely — a cancelled download leaves no trace behind. */
export function removeJob(videoId: string): void {
  if (!(videoId in store.jobs)) return;
  const jobs = { ...store.jobs };
  delete jobs[videoId];
  commit({ jobs });
}

export function setNotice(severity: DownloadNotice['severity'], message: string): void {
  noticeSeq += 1;
  commit({ notice: { id: noticeSeq, severity, message } });
}

/**
 * Publish a transient app-wide notice — the snackbar Layout renders on top
 * of the downloads store. Exposed for callers outside the download flow
 * (e.g. "link copied" after a share).
 */
export function notify(severity: DownloadNotice['severity'], message: string): void {
  setNotice(severity, message);
}

export function subscribeDownloads(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDownloadsSnapshot(): DownloadsSnapshot {
  return store;
}

export function clearNotice(): void {
  if (store.notice) commit({ notice: null });
}