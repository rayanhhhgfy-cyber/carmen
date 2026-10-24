/**
 * FIFO concurrency gate for the offline download pipeline.
 *
 * `startDownload` used to fire every track at once: saving a 50-song
 * playlist meant 50 parallel full-file fetches, which phones (and the
 * stream server) punish with dropped connections and failed jobs. Every
 * download — single or playlist — now passes through this one queue: at
 * most `MAX_CONCURRENT_DOWNLOADS` pipelines run at a time and the rest
 * start strictly in call order as slots free up.
 */

export const MAX_CONCURRENT_DOWNLOADS = 3;

export interface DownloadQueue {
  /**
   * Runs `task` as soon as a slot is free. When every slot is busy the
   * task waits its turn (FIFO) and `onQueued` fires synchronously, so the
   * caller can mark the job accordingly. The returned promise settles
   * exactly like the task's — and a failed task releases its slot either
   * way, so one bad download can never stall the queue.
   */
  schedule(task: () => Promise<void>, onQueued?: () => void): Promise<void>;
  /** Pipelines running right now. */
  readonly activeCount: number;
  /** Tasks waiting for a slot. */
  readonly pendingCount: number;
}

export function createDownloadQueue(
  limit: number = MAX_CONCURRENT_DOWNLOADS,
): DownloadQueue {
  let active = 0;
  const pending: Array<() => void> = [];

  const drain = (): void => {
    while (active < limit && pending.length > 0) {
      const start = pending.shift() as () => void;
      active += 1;
      start();
    }
  };

  return {
    schedule(task, onQueued) {
      return new Promise<void>((resolve, reject) => {
        const start = (): void => {
          let result: Promise<void>;
          try {
            result = task();
          } catch (error) {
            result = Promise.reject(error);
          }
          // Release *before* settling the caller's promise: when an
          // `await schedule(...)` returns, the slot is already free and
          // the next task has already started.
          const release = (): void => {
            active -= 1;
            drain();
          };
          result.then(
            () => {
              release();
              resolve();
            },
            (error: unknown) => {
              release();
              reject(error);
            },
          );
        };
        if (active < limit) {
          active += 1;
          start();
        } else {
          onQueued?.();
          pending.push(start);
        }
      });
    },
    get activeCount() {
      return active;
    },
    get pendingCount() {
      return pending.length;
    },
  };
}

/** The one queue every download in the app shares. */
export const downloadQueue: DownloadQueue = createDownloadQueue();
