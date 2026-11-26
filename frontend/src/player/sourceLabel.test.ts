/**
 * Tests for the playing-from indicator mapping (`sourceLabel.ts`):
 * every source the player can be on maps to exactly one badge label,
 * the two `/stream` servers are told apart by host, and a full
 * fallback walk — primary server → retry → other server — produces
 * the labels in that order. Pure mapping only; no network, no audio
 * element.
 */
import { describe, expect, it } from 'vitest';

import type { AudioSource } from '../offline/source';
import {
  PLAYBACK_SOURCE_LABELS,
  playbackSourceForAudioSource,
  playbackSourceForStreamUrl,
  type PlaybackSourceId,
} from './sourceLabel';

const CARMEN_STREAM: AudioSource = {
  url: 'https://carmen-api.onrender.com/stream?vidId=abc',
  kind: 'stream',
};
const RELAY_STREAM: AudioSource = {
  url: 'https://api-carmen-v1.syr.qzz.io/stream?vidId=abc',
  kind: 'stream',
};

describe('playbackSourceForStreamUrl', () => {
  it('names the Render server "carmen"', () => {
    expect(playbackSourceForStreamUrl(CARMEN_STREAM.url)).toBe('carmen');
  });

  it('names the demo host "relay"', () => {
    expect(playbackSourceForStreamUrl(RELAY_STREAM.url)).toBe('relay');
  });

  it('treats a custom Settings override host as the user\'s own Carmen server', () => {
    expect(
      playbackSourceForStreamUrl('https://my-server.example/stream?vidId=abc'),
    ).toBe('carmen');
  });

  it('treats an unparseable URL as the user\'s own server, never the relay', () => {
    expect(playbackSourceForStreamUrl('not a url')).toBe('carmen');
  });
});

describe('playbackSourceForAudioSource', () => {
  it('maps downloaded files (asset and blob) to "downloaded"', () => {
    expect(
      playbackSourceForAudioSource({ url: 'asset://localhost/song.m4a', kind: 'asset' }),
    ).toBe('downloaded');
    expect(
      playbackSourceForAudioSource({ url: 'blob:http://localhost/x', kind: 'blob' }),
    ).toBe('downloaded');
  });

  it('maps the primary and fallback streams to their servers', () => {
    expect(playbackSourceForAudioSource(CARMEN_STREAM)).toBe('carmen');
    expect(playbackSourceForAudioSource(RELAY_STREAM)).toBe('relay');
  });

  it('returns null when there is no source', () => {
    expect(playbackSourceForAudioSource(null)).toBeNull();
  });

  it('walks the full fallback chain in order', () => {
    // Primary server → retry on the same server → other server
    // (see PlayerContext).
    const chain: AudioSource[] = [
      CARMEN_STREAM,
      { ...CARMEN_STREAM },
      RELAY_STREAM,
    ];
    expect(chain.map(playbackSourceForAudioSource)).toEqual([
      'carmen',
      'carmen',
      'relay',
    ]);
  });
});

describe('PLAYBACK_SOURCE_LABELS', () => {
  it('gives every source a short, non-empty label', () => {
    const ids: PlaybackSourceId[] = ['downloaded', 'carmen', 'relay'];
    for (const id of ids) {
      expect(PLAYBACK_SOURCE_LABELS[id]).toBeTruthy();
    }
    expect(PLAYBACK_SOURCE_LABELS).toEqual({
      downloaded: 'Downloaded',
      carmen: 'Carmen Server',
      relay: 'Relay Server',
    });
  });
});
