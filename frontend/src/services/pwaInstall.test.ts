/**
 * Unit tests for the PWA install prompt capture.
 *
 * Regression test for the Settings crash: `getPwaInstallSnapshot` used to
 * build a fresh object literal on every call, and `PwaInstallRow` reads it
 * through `useSyncExternalStore` — which compares snapshots with
 * `Object.is` — so React re-rendered forever and the whole app unmounted
 * with "Minified React error #185" the moment Settings opened.
 * The snapshot must keep the same reference while nothing changed.
 */
import { describe, expect, it } from 'vitest';

import { getPwaInstallSnapshot, initPwaInstall } from './pwaInstall';

describe('getPwaInstallSnapshot', () => {
  it('returns the same object reference across calls when nothing changed', () => {
    const first = getPwaInstallSnapshot();
    const second = getPwaInstallSnapshot();
    expect(second).toBe(first);
  });

  it('stays referentially stable after init (no prompt event in this env)', () => {
    initPwaInstall();
    const first = getPwaInstallSnapshot();
    const second = getPwaInstallSnapshot();
    expect(second).toBe(first);
    expect(first).toEqual({
      installed: false,
      canInstall: false,
      dismissed: false,
      isIos: false,
    });
  });
});
