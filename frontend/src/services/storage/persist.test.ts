/**
 * `ensurePersistentStorage` — the one call that keeps the browser from
 * evicting the offline library (IndexedDB is best-effort until the
 * origin is persisted).
 *
 * Pinned behaviour: no-op on Tauri and when the Storage API is missing,
 * no re-request when storage is already persisted, at most one request
 * per session, and failures resolve to `false` instead of throwing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ isTauri: false }));

vi.mock('../env', () => ({
  // Getters: the factory runs once, but the flag must read live per test.
  get isTauri() {
    return env.isTauri;
  },
  get isBrowser() {
    return !env.isTauri;
  },
  isDesktop: false,
  isIOS: false,
}));

interface StorageStub {
  persisted: () => Promise<boolean>;
  persist: () => Promise<boolean>;
}

function stubNavigatorStorage(storage: StorageStub | undefined): void {
  vi.stubGlobal('navigator', { storage });
}

/** Fresh module per scenario — the once-per-session latch must not leak. */
async function loadHelper() {
  vi.resetModules();
  return import('./persist');
}

beforeEach(() => {
  env.isTauri = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ensurePersistentStorage', () => {
  it('returns true without requesting when storage is already persisted', async () => {
    const persist = vi.fn(async () => true);
    stubNavigatorStorage({ persisted: async () => true, persist });
    const { ensurePersistentStorage } = await loadHelper();

    await expect(ensurePersistentStorage()).resolves.toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('requests persistence once per session when not yet persisted', async () => {
    const persist = vi.fn(async () => true);
    stubNavigatorStorage({ persisted: async () => false, persist });
    const { ensurePersistentStorage } = await loadHelper();

    await expect(ensurePersistentStorage()).resolves.toBe(true);
    // Second call: still not persisted (stub), but no second request.
    await expect(ensurePersistentStorage()).resolves.toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('resolves false when the browser declines the request', async () => {
    stubNavigatorStorage({ persisted: async () => false, persist: async () => false });
    const { ensurePersistentStorage } = await loadHelper();

    await expect(ensurePersistentStorage()).resolves.toBe(false);
  });

  it('no-ops when the Storage API is missing', async () => {
    stubNavigatorStorage(undefined);
    const { ensurePersistentStorage } = await loadHelper();

    await expect(ensurePersistentStorage()).resolves.toBe(false);
  });

  it('no-ops on Tauri even when the API exists', async () => {
    env.isTauri = true;
    const persist = vi.fn(async () => true);
    stubNavigatorStorage({ persisted: async () => false, persist });
    const { ensurePersistentStorage } = await loadHelper();

    await expect(ensurePersistentStorage()).resolves.toBe(false);
    expect(persist).not.toHaveBeenCalled();
  });

  it('resolves false instead of throwing when the API rejects', async () => {
    stubNavigatorStorage({
      persisted: async () => {
        throw new Error('blocked');
      },
      persist: async () => true,
    });
    const { ensurePersistentStorage } = await loadHelper();

    await expect(ensurePersistentStorage()).resolves.toBe(false);
  });
});
