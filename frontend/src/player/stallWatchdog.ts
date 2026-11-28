/**
 * Stall watchdog: how long a stream may sit at 0:00 with no data before
 * the player treats the source as dead and runs the fallback chain.
 *
 * A stream request that never answers fires no `error` event — the element
 * just sits at `readyState` 0 while the server grinds (an uncached song
 * used to hang this way until the hosting edge killed the request at ~60s,
 * surfacing only as `NotSupportedError`). The watchdog bounds that wait:
 * 20s is comfortably above a working extraction (a cache hit plays in
 * 1–2s; a fresh extraction resolves in ~5–15s) and well below the ~60s
 * edge kill, so a hung source fails over to the other server while the
 * user is still waiting instead of spinning for a minute.
 *
 * The predicate is pure so it can be unit-tested; the timer itself lives
 * in PlayerContext, next to the existing stall spinner.
 */

export const STALL_WATCHDOG_MS = 20_000;

export interface StalledLoadState {
  readyState: number;
  currentTime: number;
  paused: boolean;
  error: boolean;
}

/**
 * True when the element is supposed to be playing a stream but has not
 * received any data yet: no usable data (`readyState` < 2 =
 * HAVE_CURRENT_DATA), playhead still at 0, not paused by the user, and no
 * media error (an error already routes through `handleError` on its own).
 */
export function isStalledLoad(state: StalledLoadState): boolean {
  return (
    state.readyState < 2 &&
    state.currentTime === 0 &&
    !state.paused &&
    !state.error
  );
}
