/**
 * Sleep timer — pure countdown state machine + fade curve.
 *
 * This module knows nothing about React, the DOM or the `<audio>` element:
 * every function is a pure function of its arguments, so the whole
 * behaviour below is pinned by `sleepTimer.test.ts` without a browser.
 * `PlayerContext` is the only driver: it owns the wall-clock timers, owns
 * the `<audio>` element, and translates the events here (`fade`,
 * `expired`) into volume writes and a pause.
 *
 * Scope — SESSION-SCOPED, deliberately not persisted. The timer lives
 * only in PlayerContext state: it does not survive a page reload, and it
 * is not written to the playback-persistence snapshot. A persisted timer
 * would wake up after a reload with a stale deadline and pause a session
 * the user had already abandoned; a session timer simply starts over.
 * The user re-sets it from the player menu, which is one tap away.
 *
 * Clock — WALL-CLOCK, not playback-time. A minutes timer keeps counting
 * while playback is paused, and it keeps running across track changes:
 * only the end-of-track mode is tied to one track (see below). Pausing
 * does not pause the timer, and skipping does not reset it.
 *
 * End-of-track mode — bound to the track that was playing when the timer
 * was set (`trackVideoId`). It has no deadline: `advanceSleepTimer` never
 * expires it on the clock. It fires only through `onSleepTrackEnded`,
 * which PlayerContext calls from its existing end-of-song path (see the
 * note on that function). If the user manually moves to a different
 * track, PlayerContext clears an end-of-track timer — that track is over
 * by the user's own action, so the "end of this track" timer no longer
 * has a track to end on. A minutes timer is untouched by track changes.
 *
 * Fade — on expiry (deadline reached, or end-of-track fired) the driver
 * steps `audio.volume` from its live value down to 0 over
 * `SLEEP_TIMER_FADE_DURATION_MS` (10 s, one step every
 * `SLEEP_TIMER_FADE_STEP_MS`), then pauses. The driver restores
 * `audio.volume` to the pre-fade value right after the pause, so a later
 * manual resume plays at normal volume instead of silence. Cancelling
 * or changing the timer mid-fade also restores the pre-fade volume
 * (the driver's effect cleanup does that); cancelling mid-countdown
 * needs no restore because the volume was never touched.
 *
 * Fade curve — cosine ease (`fadeVolumeAt`): volume falls slowly at the
 * start and the end and fastest in the middle, which sounds like a
 * gentle fade-out rather than a linear slide that seems to vanish early.
 * It is exactly the pre-fade volume at elapsed 0, exactly half of it at
 * the midpoint, and exactly 0 at the end.
 */

/** What the player menu offers. `off` cancels; the numbers are minutes. */
export type SleepTimerOption = 'off' | 'end-of-track' | 15 | 30 | 45 | 60;

/** The minute options the menu shows, in order. */
export const SLEEP_TIMER_MINUTE_OPTIONS = [15, 30, 45, 60] as const;

/** Fade-out length once a timer expires: ~10 seconds. */
export const SLEEP_TIMER_FADE_DURATION_MS = 10_000;

/** One volume step every 500 ms during the fade (20 steps total). */
export const SLEEP_TIMER_FADE_STEP_MS = 500;

export type SleepTimerStatus = 'idle' | 'counting' | 'fading';

export interface SleepTimerState {
  /** The option the user picked; `'off'` only ever appears on idle state. */
  option: SleepTimerOption;
  status: SleepTimerStatus;
  /** Wall-clock deadline (epoch ms) for minute timers; null otherwise. */
  endsAtMs: number | null;
  /** Epoch ms the fade started; null unless `status === 'fading'`. */
  fadeStartedAtMs: number | null;
  /**
   * Volume the fade started from. The pure machine defaults this to 1
   * (Carmen has no volume UI, so the element normally plays at full
   * level); the PlayerContext driver overwrites it with the live
   * `audio.volume` at fade start, which is the value it restores.
   */
  fadeFromVolume: number;
  /**
   * The track an end-of-track timer is bound to; null for minute timers
   * and for idle state.
   */
  trackVideoId: string | null;
}

/** No timer running. */
export const IDLE_SLEEP_TIMER: SleepTimerState = {
  option: 'off',
  status: 'idle',
  endsAtMs: null,
  fadeStartedAtMs: null,
  fadeFromVolume: 1,
  trackVideoId: null,
};

export function isSleepTimerActive(state: SleepTimerState): boolean {
  return state.status !== 'idle';
}

/**
 * Start (or replace) a timer. Starting a new option always resets the
 * countdown from `nowMs` — changing 15 → 30 mid-countdown gives a full
 * 30 minutes, never the remainder of the old timer. `'off'` clears.
 * `trackVideoId` is recorded only for end-of-track mode.
 */
export function startSleepTimer(
  option: SleepTimerOption,
  nowMs: number,
  trackVideoId: string | null = null,
): SleepTimerState {
  if (option === 'off') return { ...IDLE_SLEEP_TIMER };
  if (option === 'end-of-track') {
    return {
      option,
      status: 'counting',
      endsAtMs: null,
      fadeStartedAtMs: null,
      fadeFromVolume: 1,
      trackVideoId,
    };
  }
  return {
    option,
    status: 'counting',
    endsAtMs: nowMs + option * 60_000,
    fadeStartedAtMs: null,
    fadeFromVolume: 1,
    trackVideoId: null,
  };
}

/** Cancel: back to idle, whatever phase the timer was in. */
export function cancelSleepTimer(): SleepTimerState {
  return { ...IDLE_SLEEP_TIMER };
}

/**
 * Milliseconds left on a minute timer, clamped at 0 — null for idle and
 * for end-of-track mode (which has no clock deadline), and 0 while
 * fading (the countdown is over; the fade is what remains).
 */
export function remainingMs(state: SleepTimerState, nowMs: number): number | null {
  if (state.status === 'fading') return 0;
  if (state.status !== 'counting' || state.endsAtMs === null) return null;
  return Math.max(0, state.endsAtMs - nowMs);
}

/** `mm:ss` for a remaining-ms value; negative values show as `0:00`. */
export function formatSleepRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Fade curve: the volume at `elapsedMs` into a fade of `durationMs`
 * starting from `fromVolume`. Cosine ease — exactly `fromVolume` at 0,
 * exactly half at the midpoint, exactly 0 at (or past) the end, and
 * monotonically decreasing in between. Inputs are clamped, so a
 * negative elapsed or an over-long one can never produce a volume
 * outside `[0, fromVolume]`.
 */
export function fadeVolumeAt(
  elapsedMs: number,
  fromVolume: number,
  durationMs: number = SLEEP_TIMER_FADE_DURATION_MS,
): number {
  if (durationMs <= 0 || fromVolume <= 0) return 0;
  const progress = Math.min(1, Math.max(0, elapsedMs / durationMs));
  return fromVolume * 0.5 * (1 + Math.cos(Math.PI * progress));
}

export type SleepTimerEvent = 'none' | 'fade' | 'expired';

/**
 * Advance the machine to `nowMs`.
 *
 * - Counting minute timer at/past its deadline → `fading` + `'fade'`
 *   (the driver starts stepping the volume and, after the fade, pauses).
 * - Fading timer at/past fade end → idle + `'expired'` (the driver has
 *   by then paused; this is the machine's own end of the fade phase).
 * - End-of-track timers never advance on the clock — they only fire via
 *   `onSleepTrackEnded`.
 * - Everything else → unchanged state + `'none'`.
 */
export function advanceSleepTimer(
  state: SleepTimerState,
  nowMs: number,
): { state: SleepTimerState; event: SleepTimerEvent } {
  if (state.status === 'counting' && state.endsAtMs !== null && nowMs >= state.endsAtMs) {
    return {
      state: {
        ...state,
        status: 'fading',
        fadeStartedAtMs: nowMs,
      },
      event: 'fade',
    };
  }
  if (
    state.status === 'fading' &&
    state.fadeStartedAtMs !== null &&
    nowMs - state.fadeStartedAtMs >= SLEEP_TIMER_FADE_DURATION_MS
  ) {
    return { state: { ...IDLE_SLEEP_TIMER }, event: 'expired' };
  }
  return { state, event: 'none' };
}

/**
 * The end-of-track hook — the ONLY way an end-of-track timer fires.
 *
 * How PlayerContext detects end-of-track (this is the existing track-end
 * path, not a new listener): PlayerContext's `handleTrackEnded` is the
 * single entry point for both the `<audio>` element's `onEnded` event
 * and the `onTimeUpdate` watchdog, which fires when the playhead reaches
 * the metadata duration (`current.durationSeconds` /
 * `meta.duration_seconds`, authoritative over the container's own
 * duration) minus 0.25 s — the watchdog exists because a corrupted /
 * doubled m4a can keep "running" past its true end without ever firing
 * `ended`. Both paths are guarded by `trackEndedRef` so one song ends
 * exactly once. When an end-of-track timer is counting, PlayerContext
 * calls this function from `handleTrackEnded` BEFORE the repeat / queue
 * logic, so the timer's fade-and-pause replaces advancing to the next
 * track (and beats repeat-one, which would otherwise replay the song).
 *
 * Returns `fading` + `'fade'` for a counting end-of-track timer, and the
 * state untouched + `'none'` for every other state — a minute timer, an
 * idle timer, or an already-fading timer is never fired by a track end.
 */
export function onSleepTrackEnded(
  state: SleepTimerState,
  nowMs: number,
): { state: SleepTimerState; event: SleepTimerEvent } {
  if (state.status === 'counting' && state.option === 'end-of-track') {
    return {
      state: {
        ...state,
        status: 'fading',
        fadeStartedAtMs: nowMs,
      },
      event: 'fade',
    };
  }
  return { state, event: 'none' };
}
