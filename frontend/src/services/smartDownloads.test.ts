/**
 * Smart downloads — pinned behaviour.
 *
 * The network gate is the honest part of this feature (the web cannot
 * reliably tell Wi-Fi from cellular), so its cases are pinned one by one:
 * provable Wi-Fi passes, everything unknown/cellular is metered, a
 * missing connection object is metered by safe default, and only the
 * explicit "allow on metered" opt-in (or switching Wi-Fi-only off)
 * overrides a metered verdict. Selection pins the opt-out list,
 * already-downloaded skipping, and cross-source dedupe. The runner pins
 * that it reuses the one injected pipeline entry point per source group
 * and that one failing group never cancels the rest.
 */
import { describe, expect, it, vi } from 'vitest';

import type { Track } from '../types/models';
import {
  DEFAULT_SMART_DOWNLOAD_SETTINGS,
  evaluateNetworkGate,
  formatSmartDownloadsStatus,
  getSmartDownloadsStatus,
  runSmartDownloads,
  selectSmartDownloads,
  type SmartDownloadSettings,
} from './smartDownloads';

function track(videoId: string, title = videoId): Track {
  return {
    videoId,
    title,
    artists: [],
    artist: '',
    album: null,
    albumName: '',
    duration: null,
    durationSeconds: null,
    artwork: null,
    year: null,
    releaseDate: null,
    isExplicit: false,
    playlistId: null,
  };
}

function settings(patch: Partial<SmartDownloadSettings> = {}): SmartDownloadSettings {
  return { ...DEFAULT_SMART_DOWNLOAD_SETTINGS, ...patch };
}

describe('network gate (best effort — see smartDownloads.ts header)', () => {
  it('passes provable Wi-Fi and ethernet', () => {
    for (const type of ['wifi', 'ethernet']) {
      const gate = evaluateNetworkGate(settings(), { type });
      expect(gate.allowed).toBe(true);
      expect(gate.metered).toBe(false);
    }
  });

  it('blocks cellular unless the metered opt-in is on', () => {
    expect(evaluateNetworkGate(settings(), { type: 'cellular' }).allowed).toBe(false);
    expect(
      evaluateNetworkGate(settings({ allowMetered: true }), { type: 'cellular' }).allowed,
    ).toBe(true);
  });

  it('treats data saver as metered', () => {
    expect(evaluateNetworkGate(settings(), { type: 'wifi', saveData: true }).allowed).toBe(
      false,
    );
  });

  it('treats an unavailable connection as metered (safe default)', () => {
    const gate = evaluateNetworkGate(settings(), null);
    expect(gate.metered).toBe(true);
    expect(gate.allowed).toBe(false);
    expect(
      evaluateNetworkGate(settings({ allowMetered: true }), null).allowed,
    ).toBe(true);
  });

  it('treats an unknown/missing type as metered — effectiveType never proves Wi-Fi', () => {
    for (const connection of [{}, { effectiveType: '4g' }, { type: 'unknown' }]) {
      const gate = evaluateNetworkGate(settings(), connection);
      expect(gate.metered).toBe(true);
      expect(gate.allowed).toBe(false);
    }
  });

  it('switching Wi-Fi-only off allows any live connection, but never "none"', () => {
    expect(
      evaluateNetworkGate(settings({ wifiOnly: false }), { type: 'cellular' }).allowed,
    ).toBe(true);
    expect(
      evaluateNetworkGate(
        settings({ wifiOnly: false, allowMetered: true }),
        { type: 'none' },
      ).allowed,
    ).toBe(false);
  });
});

describe('selection', () => {
  it('respects the per-playlist opt-out: an excluded playlist never contributes', () => {
    const selection = selectSmartDownloads({
      liked: [],
      favouritePlaylists: [
        { id: 1, name: 'Keep', tracks: [track('a')] },
        { id: 2, name: 'Excluded', tracks: [track('b'), track('c')] },
      ],
      downloadedIds: new Set(),
      settings: settings({ excludedPlaylistIds: [2] }),
    });
    expect(selection.tracks.map((t) => t.videoId)).toEqual(['a']);
    expect(selection.skippedExcluded).toBe(2);
  });

  it('skips already-downloaded tracks and tracks without an id', () => {
    const selection = selectSmartDownloads({
      liked: [track('a'), track('b'), track('')],
      favouritePlaylists: [],
      downloadedIds: new Set(['a']),
      settings: settings(),
    });
    expect(selection.tracks.map((t) => t.videoId)).toEqual(['b']);
    expect(selection.alreadyDownloaded).toBe(1);
    expect(selection.skippedNoId).toBe(1);
  });

  it('downloads a track once even when it appears in liked and a playlist', () => {
    const selection = selectSmartDownloads({
      liked: [track('a')],
      favouritePlaylists: [{ id: 1, name: 'Mix', tracks: [track('a'), track('b')] }],
      downloadedIds: new Set(),
      settings: settings(),
    });
    expect(selection.tracks.map((t) => t.videoId)).toEqual(['a', 'b']);
    expect(selection.groups[0].label).toBe('Liked songs');
    expect(selection.groups[1].tracks.map((t) => t.videoId)).toEqual(['b']);
  });
});

describe('runner', () => {
  it('does nothing when both smart toggles are off', async () => {
    const downloadTracks = vi.fn(() => 0);
    const result = await runSmartDownloads(
      {
        settings: settings(),
        connection: { type: 'wifi' },
        listLiked: async () => [track('a')],
        listFavouritePlaylists: async () => [],
        listDownloadedIds: async () => [],
        downloadTracks,
      },
      { force: true },
    );
    expect(result.phase).toBe('off');
    expect(downloadTracks).not.toHaveBeenCalled();
  });

  it('does not call the pipeline when the network gate blocks', async () => {
    const downloadTracks = vi.fn(() => 0);
    const result = await runSmartDownloads(
      {
        settings: settings({ likedEnabled: true }),
        connection: null,
        listLiked: async () => [track('a')],
        listFavouritePlaylists: async () => [],
        listDownloadedIds: async () => [],
        downloadTracks,
      },
      { force: true },
    );
    expect(result.phase).toBe('blocked');
    expect(result.blockedReason).toMatch(/treated as metered/);
    expect(downloadTracks).not.toHaveBeenCalled();
  });

  it('reuses the one pipeline entry point per source group, in order', async () => {
    const downloadTracks = vi.fn((tracks: Track[]) => tracks.length);
    const result = await runSmartDownloads(
      {
        settings: settings({
          likedEnabled: true,
          favouritePlaylistsEnabled: true,
          excludedPlaylistIds: [99],
        }),
        connection: { type: 'wifi' },
        listLiked: async () => [track('a'), track('dl')],
        listFavouritePlaylists: async () => [
          { id: 1, name: 'Mix', tracks: [track('b'), track('a')] },
        ],
        listDownloadedIds: async () => ['dl'],
        downloadTracks,
      },
      { force: true },
    );
    expect(result.phase).toBe('done');
    expect(result.started).toBe(2);
    expect(result.alreadyDownloaded).toBe(1);
    // Liked batch first, then the playlist batch minus the duplicate.
    expect(downloadTracks).toHaveBeenCalledTimes(2);
    expect(downloadTracks.mock.calls[0][0].map((t: Track) => t.videoId)).toEqual(['a']);
    expect(downloadTracks.mock.calls[1][0].map((t: Track) => t.videoId)).toEqual(['b']);
    expect(getSmartDownloadsStatus().started).toBe(2);
  });

  it('a failing group does not stall the groups behind it', async () => {
    const downloadTracks = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementation((tracks: Track[]) => tracks.length);
    const result = await runSmartDownloads(
      {
        settings: settings({
          likedEnabled: true,
          favouritePlaylistsEnabled: true,
          excludedPlaylistIds: [98],
        }),
        connection: { type: 'wifi' },
        listLiked: async () => [track('a')],
        listFavouritePlaylists: async () => [{ id: 1, name: 'Mix', tracks: [track('b')] }],
        listDownloadedIds: async () => [],
        downloadTracks,
      },
      { force: true },
    );
    expect(result.phase).toBe('done');
    expect(result.started).toBe(1);
    expect(downloadTracks).toHaveBeenCalledTimes(2);
  });

  it('coalesces a concurrent second run instead of downloading twice', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const downloadTracks = vi.fn(async () => {
      await gate;
      return 1;
    });
    const deps = {
      settings: settings({ likedEnabled: true, excludedPlaylistIds: [97] }),
      connection: { type: 'wifi' },
      listLiked: async () => [track('a')],
      listFavouritePlaylists: async () => [],
      listDownloadedIds: async () => [],
      downloadTracks,
    };
    const first = runSmartDownloads(deps, { force: true });
    const second = runSmartDownloads(deps, { force: true });
    release();
    await Promise.all([first, second]);
    expect(downloadTracks).toHaveBeenCalledTimes(1);
  });
});

describe('status line wording', () => {
  it('says blocked with the gate reason, and off when disabled', () => {
    expect(
      formatSmartDownloadsStatus(
        {
          phase: 'blocked',
          lastRunAt: null,
          started: 0,
          startedIds: [],
          alreadyDownloaded: 0,
          skippedExcluded: 0,
          blockedReason: 'the connection looks cellular (metered)',
          error: null,
        },
        {},
      ),
    ).toMatch(/paused — the connection looks cellular/);
    expect(
      formatSmartDownloadsStatus(
        {
          phase: 'off',
          lastRunAt: null,
          started: 0,
          startedIds: [],
          alreadyDownloaded: 0,
          skippedExcluded: 0,
          blockedReason: null,
          error: null,
        },
        {},
      ),
    ).toMatch(/are off/);
  });

  it('derives queued / downloading / done from the job store', () => {
    const base = {
      phase: 'downloading' as const,
      lastRunAt: Date.now(),
      started: 3,
      startedIds: ['a', 'b', 'c'],
      alreadyDownloaded: 1,
      skippedExcluded: 0,
      blockedReason: null,
      error: null,
    };
    expect(
      formatSmartDownloadsStatus(base, {
        // Queued-ness comes from the job's `queued` flag, not its step
        // text (waiting jobs now show "Nth in line" as their step).
        a: { status: 'running', step: '3rd in line', queued: true },
        b: { status: 'running', step: 'Downloading audio' },
        c: { status: 'done' },
      }),
    ).toMatch(/downloading 1 · queued 1 · 1 saved · 1 already on device/);
    expect(
      formatSmartDownloadsStatus(base, {
        a: { status: 'done' },
        b: { status: 'done' },
        c: { status: 'error' },
      }),
    ).toMatch(/2 saved · 1 failed · 1 already on device/);
  });
});
