/**
 * Tests for the tap-prime guard (`matchesTapPrime` in PlayerContext.tsx):
 * the load effect must trust only the prime recorded synchronously in
 * `playTrack`'s tap gesture — never `audio.currentSrc`, whose update
 * timing Safari does not guarantee. On a real iPhone `currentSrc` can
 * still read "" when the effect runs, and the old `currentSrc` guard
 * then re-set src/load and called play() outside the gesture, which iOS
 * rejects with NotAllowedError ("Playback was blocked by the system")
 * and aborts the primed play — the song never starts. Pure decision
 * logic only; no audio element, no network.
 */
import { describe, expect, it } from 'vitest';

import { matchesTapPrime, type TapPrime } from './PlayerContext';

const PRIME: TapPrime = {
  videoId: 'abc123',
  url: 'https://carmen-api.onrender.com/stream?vidId=abc123',
};

describe('matchesTapPrime', () => {
  it('matches the exact track + URL primed in the tap', () => {
    expect(matchesTapPrime(PRIME, 'abc123', PRIME.url)).toBe(true);
  });

  it('does not match with no prime recorded', () => {
    expect(matchesTapPrime(null, 'abc123', PRIME.url)).toBe(false);
  });

  it('does not match a prime for a different track', () => {
    expect(
      matchesTapPrime(PRIME, 'other-track', PRIME.url),
    ).toBe(false);
  });

  it('does not match a prime for a different URL', () => {
    expect(
      matchesTapPrime(
        PRIME,
        'abc123',
        'https://api-carmen-v1.syr.qzz.io/stream?vidId=abc123',
      ),
    ).toBe(false);
  });

  it('matches even when the element reports currentSrc "" — the regression', () => {
    // This is the exact Safari case that blocked playback: the prime was
    // recorded synchronously in the tap, but currentSrc had not caught
    // up yet when the load effect ran. The old guard
    // (audio.currentSrc === source.url) read "" === url → false and
    // re-played outside the gesture. The ref-based check ignores
    // currentSrc entirely, so the primed play is left alone.
    const elementCurrentSrc = '';
    expect(elementCurrentSrc === PRIME.url).toBe(false);
    expect(matchesTapPrime(PRIME, 'abc123', PRIME.url)).toBe(true);
  });

  it('does not match a stale prime from the previous song', () => {
    const stalePrime: TapPrime = {
      videoId: 'previous-song',
      url: 'https://carmen-api.onrender.com/stream?vidId=previous-song',
    };
    expect(matchesTapPrime(stalePrime, 'abc123', PRIME.url)).toBe(false);
  });
});
