/**
 * Sleep timer — pure-machine tests.
 *
 * What is pinned here: the countdown, the fade curve, cancel, change
 * (reset), and end-of-track firing. What is NOT tested here (and why):
 * the actual `audio.pause()` call lives in the PlayerContext driver,
 * which needs a rendered provider — this repo's vitest has no component
 * renderer installed and adding one would be a new dependency, which
 * this workstream forbids. The driver is a thin translation of the
 * events pinned here (`fade` → step the volume, `expired` → pause),
 * and its fade/cancel/restore behaviour is documented in sleepTimer.ts
 * and PlayerContext.tsx.
 */
import { describe, expect, it } from 'vitest';

import {
  advanceSleepTimer,
  cancelSleepTimer,
  fadeVolumeAt,
  formatSleepRemaining,
  IDLE_SLEEP_TIMER,
  isSleepTimerActive,
  onSleepTrackEnded,
  remainingMs,
  SLEEP_TIMER_FADE_DURATION_MS,
  startSleepTimer,
} from './sleepTimer';

const MIN = 60_000;

describe('sleep timer countdown', () => {
  it('a minute timer counts down from its full length and is active', () => {
    const timer = startSleepTimer(15, 1_000);
    expect(timer.status).toBe('counting');
    expect(timer.option).toBe(15);
    expect(timer.endsAtMs).toBe(1_000 + 15 * MIN);
    expect(remainingMs(timer, 1_000)).toBe(15 * MIN);
    expect(remainingMs(timer, 1_000 + 5 * MIN)).toBe(10 * MIN);
    expect(isSleepTimerActive(timer)).toBe(true);
    expect(isSleepTimerActive(IDLE_SLEEP_TIMER)).toBe(false);
  });

  it('expiry moves counting -> fading (fade), then fading -> idle (expired)', () => {
    const timer = startSleepTimer(30, 0);
    // One ms before the deadline: still counting, no event.
    expect(advanceSleepTimer(timer, 30 * MIN - 1).event).toBe('none');
    // At the deadline: the fade starts — this is the "expiry triggers
    // fade" half. The driver steps the volume from here and pauses when
    // the fade completes (see the module header).
    const faded = advanceSleepTimer(timer, 30 * MIN);
    expect(faded.event).toBe('fade');
    expect(faded.state.status).toBe('fading');
    expect(faded.state.fadeStartedAtMs).toBe(30 * MIN);
    expect(remainingMs(faded.state, 30 * MIN)).toBe(0);
    // Mid-fade: still fading, no expiry yet.
    expect(advanceSleepTimer(faded.state, 30 * MIN + 5_000).event).toBe('none');
    // Past the ~10 s fade: expired, back to idle — the "then pause" half.
    const expired = advanceSleepTimer(faded.state, 30 * MIN + SLEEP_TIMER_FADE_DURATION_MS);
    expect(expired.event).toBe('expired');
    expect(expired.state).toEqual(IDLE_SLEEP_TIMER);
  });

  it('every offered minute option expires at its own deadline', () => {
    for (const minutes of [15, 30, 45, 60] as const) {
      const timer = startSleepTimer(minutes, 0);
      expect(advanceSleepTimer(timer, minutes * MIN - 1).event).toBe('none');
      expect(advanceSleepTimer(timer, minutes * MIN).event).toBe('fade');
    }
  });
});

describe('sleep timer fade curve', () => {
  it('starts at full volume, halves at the midpoint, ends at silence', () => {
    expect(fadeVolumeAt(0, 1)).toBe(1);
    expect(fadeVolumeAt(SLEEP_TIMER_FADE_DURATION_MS / 2, 1)).toBeCloseTo(0.5, 10);
    expect(fadeVolumeAt(SLEEP_TIMER_FADE_DURATION_MS, 1)).toBe(0);
    expect(fadeVolumeAt(SLEEP_TIMER_FADE_DURATION_MS + 5_000, 1)).toBe(0);
    // Scales with the pre-fade volume and never leaves [0, from].
    expect(fadeVolumeAt(0, 0.8)).toBe(0.8);
    expect(fadeVolumeAt(SLEEP_TIMER_FADE_DURATION_MS / 2, 0.8)).toBeCloseTo(0.4, 10);
  });

  it('decreases monotonically and clamps out-of-range elapsed time', () => {
    const steps = [0, 1_000, 2_500, 5_000, 7_500, 9_000, 10_000].map((t) =>
      fadeVolumeAt(t, 1),
    );
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i]!).toBeLessThan(steps[i - 1]!);
    }
    expect(fadeVolumeAt(-1_000, 1)).toBe(1);
    expect(fadeVolumeAt(0, 0)).toBe(0);
  });
});

describe('sleep timer cancel and change', () => {
  it('cancel clears a counting timer (volume was never touched)', () => {
    const timer = startSleepTimer(15, 0);
    const cancelled = cancelSleepTimer();
    expect(cancelled).toEqual(IDLE_SLEEP_TIMER);
    expect(remainingMs(cancelled, 5 * MIN)).toBeNull();
    expect(isSleepTimerActive(cancelled)).toBe(false);
    // Cancelling is also what 'off' means when starting fresh.
    expect(startSleepTimer('off', 0)).toEqual(IDLE_SLEEP_TIMER);
    void timer;
  });

  it('cancel clears a fading timer too, so the driver restores volume', () => {
    const fading = advanceSleepTimer(startSleepTimer(15, 0), 15 * MIN).state;
    expect(fading.status).toBe('fading');
    expect(cancelSleepTimer()).toEqual(IDLE_SLEEP_TIMER);
  });

  it('changing the timer mid-countdown resets the countdown from now', () => {
    const first = startSleepTimer(15, 0);
    // 10 minutes into a 15-minute timer, the user picks 30 instead.
    const changed = startSleepTimer(30, 10 * MIN);
    expect(changed.endsAtMs).toBe(10 * MIN + 30 * MIN);
    // The old deadline must not leak through: at the old 15-minute mark
    // the new timer is still counting with 25 minutes left.
    expect(advanceSleepTimer(changed, 15 * MIN).event).toBe('none');
    expect(remainingMs(changed, 15 * MIN)).toBe(25 * MIN);
    void first;
  });

  it('changing to off mid-countdown clears, and re-setting starts fresh', () => {
    const timer = startSleepTimer(60, 0);
    const cleared = startSleepTimer('off', 20 * MIN);
    expect(cleared).toEqual(IDLE_SLEEP_TIMER);
    const fresh = startSleepTimer(15, 20 * MIN);
    expect(fresh.endsAtMs).toBe(20 * MIN + 15 * MIN);
    void timer;
  });
});

describe('sleep timer end-of-track mode', () => {
  it('has no clock deadline and never expires on time alone', () => {
    const timer = startSleepTimer('end-of-track', 0, 'video-123');
    expect(timer.status).toBe('counting');
    expect(timer.endsAtMs).toBeNull();
    expect(timer.trackVideoId).toBe('video-123');
    expect(remainingMs(timer, 0)).toBeNull();
    // Even hours later, the clock alone does nothing.
    expect(advanceSleepTimer(timer, 10 * 60 * MIN).event).toBe('none');
    expect(advanceSleepTimer(timer, 10 * 60 * MIN).state).toEqual(timer);
  });

  it('fires fade on track end, then expires after the fade', () => {
    const timer = startSleepTimer('end-of-track', 0, 'video-123');
    const faded = onSleepTrackEnded(timer, 3 * MIN);
    expect(faded.event).toBe('fade');
    expect(faded.state.status).toBe('fading');
    const expired = advanceSleepTimer(
      faded.state,
      3 * MIN + SLEEP_TIMER_FADE_DURATION_MS,
    );
    expect(expired.event).toBe('expired');
    expect(expired.state).toEqual(IDLE_SLEEP_TIMER);
  });

  it('a track end does not fire a minute timer, an idle timer, or a second fade', () => {
    expect(onSleepTrackEnded(startSleepTimer(15, 0), 5 * MIN).event).toBe('none');
    expect(onSleepTrackEnded(IDLE_SLEEP_TIMER, 5 * MIN).event).toBe('none');
    const fading = onSleepTrackEnded(startSleepTimer('end-of-track', 0, 'v'), 1).state;
    expect(onSleepTrackEnded(fading, 2).event).toBe('none');
  });
});

describe('sleep timer remaining formatting', () => {
  it('formats mm:ss and clamps negatives', () => {
    expect(formatSleepRemaining(0)).toBe('0:00');
    expect(formatSleepRemaining(90_000)).toBe('1:30');
    expect(formatSleepRemaining(14 * MIN + 32_000)).toBe('14:32');
    expect(formatSleepRemaining(59 * MIN + 59_000)).toBe('59:59');
    expect(formatSleepRemaining(-5_000)).toBe('0:00');
  });
});
