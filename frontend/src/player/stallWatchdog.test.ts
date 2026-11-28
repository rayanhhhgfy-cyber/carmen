import { describe, expect, it } from 'vitest';
import { STALL_WATCHDOG_MS, isStalledLoad } from './stallWatchdog';

describe('isStalledLoad', () => {
  it('flags a stream stuck at 0 with no data while playing', () => {
    expect(
      isStalledLoad({
        readyState: 0,
        currentTime: 0,
        paused: false,
        error: false,
      }),
    ).toBe(true);
  });

  it('does not flag once data arrived', () => {
    expect(
      isStalledLoad({
        readyState: 2,
        currentTime: 0,
        paused: false,
        error: false,
      }),
    ).toBe(false);
  });

  it('does not flag once the playhead moved', () => {
    expect(
      isStalledLoad({
        readyState: 1,
        currentTime: 0.5,
        paused: false,
        error: false,
      }),
    ).toBe(false);
  });

  it('does not flag a stream the user paused at 0', () => {
    expect(
      isStalledLoad({
        readyState: 0,
        currentTime: 0,
        paused: true,
        error: false,
      }),
    ).toBe(false);
  });

  it('does not flag when a media error already fired', () => {
    expect(
      isStalledLoad({
        readyState: 0,
        currentTime: 0,
        paused: false,
        error: true,
      }),
    ).toBe(false);
  });
});

describe('STALL_WATCHDOG_MS', () => {
  it('sits between a working extraction and the ~60s edge kill', () => {
    expect(STALL_WATCHDOG_MS).toBeGreaterThan(15_000);
    expect(STALL_WATCHDOG_MS).toBeLessThan(60_000);
  });
});
