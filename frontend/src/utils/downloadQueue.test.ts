/**
 * FIFO download queue — the concurrency gate every offline download
 * (single or playlist) passes through.
 *
 * Pinned behaviour: never more than the limit running at once, queued
 * tasks start strictly in call order as slots free up, and a failed
 * task releases its slot instead of stalling everything behind it.
 */
import { describe, expect, it, vi } from 'vitest';

import { createDownloadQueue } from './downloadQueue';

interface Gate {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

function gate(): Gate {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets the queue's `.finally` drain run before asserting. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('download queue', () => {
  it('runs at most 3 tasks at once and drains the rest in FIFO order', async () => {
    const queue = createDownloadQueue();
    const started: number[] = [];
    const gates = [gate(), gate(), gate(), gate(), gate()];
    const runs = gates.map((g, index) =>
      queue.schedule(() => {
        started.push(index);
        return g.promise;
      }),
    );

    // Only the first three start; 4 and 5 wait.
    expect(started).toEqual([0, 1, 2]);
    expect(queue.activeCount).toBe(3);
    expect(queue.pendingCount).toBe(2);

    // Freeing the *first* slot starts the oldest waiter, not the newest.
    gates[0].resolve();
    await flush();
    expect(started).toEqual([0, 1, 2, 3]);
    expect(queue.activeCount).toBe(3);
    expect(queue.pendingCount).toBe(1);

    gates[2].resolve();
    await flush();
    expect(started).toEqual([0, 1, 2, 3, 4]);
    expect(queue.pendingCount).toBe(0);

    gates[1].resolve();
    gates[3].resolve();
    gates[4].resolve();
    await Promise.all(runs);
    expect(queue.activeCount).toBe(0);
  });

  it('a failed task releases its slot and never stalls the queue', async () => {
    const queue = createDownloadQueue(2);
    const started: number[] = [];
    const bad = gate();
    const good = gate();

    const failing = queue.schedule(() => {
      started.push(0);
      return bad.promise;
    });
    const blocked = queue.schedule(() => {
      started.push(1);
      return good.promise;
    });
    const waiter = queue.schedule(() => {
      started.push(2);
      return Promise.resolve();
    });
    expect(started).toEqual([0, 1]);

    bad.reject(new Error('network gone'));
    await expect(failing).rejects.toThrow('network gone');
    await flush();

    // The waiter started despite the failure ahead of it.
    expect(started).toEqual([0, 1, 2]);
    await waiter;

    good.resolve();
    await blocked;
    expect(queue.activeCount).toBe(0);
  });

  it('fires onQueued only for tasks that actually have to wait', async () => {
    const queue = createDownloadQueue(1);
    const hold = gate();
    const onQueued = vi.fn();

    const first = queue.schedule(() => hold.promise, onQueued);
    expect(onQueued).not.toHaveBeenCalled();

    const second = queue.schedule(() => Promise.resolve(), onQueued);
    expect(onQueued).toHaveBeenCalledTimes(1);

    hold.resolve();
    await first;
    await second;
  });
});
