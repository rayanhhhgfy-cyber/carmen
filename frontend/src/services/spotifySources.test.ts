/**
 * Tests for the Spotify-repo fallback sources (Audius, then iTunes):
 * the resolver tries Audius first, falls through to the iTunes preview
 * when Audius has nothing, returns null when neither has the song, and
 * never throws when a host is unreachable. The network is fully stubbed
 * — no live Audius/iTunes call is made here.
 */
import { describe, expect, it, vi } from 'vitest';

import { resolveExternalStream } from './spotifySources';

type Stub = (url: string) => Promise<{ ok: boolean; json: () => Promise<any> }>;

function stubFetch(impl: (url: string) => any): Stub {
  return vi.fn((url: string) => {
    const body = impl(url);
    if (body instanceof Error) return Promise.reject(body);
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  }) as unknown as Stub;
}

const audiusHit = {
  data: [
    {
      id: 'a123',
      title: 'Shadows Fall',
      duration: 214,
      user: { name: 'Test Artist', handle: 'testartist' },
      stream: {
        url: 'https://audius-stream.example/track/a123',
        mirrors: ['https://mirror.example'],
      },
    },
  ],
};

describe('resolveExternalStream', () => {
  it('returns the Audius full stream when Audius has a title match', async () => {
    const fetcher = stubFetch((url) =>
      url.includes('audius.co') ? audiusHit : { results: [] },
    );
    const resolved = await resolveExternalStream('Shadows Fall', 'Test Artist', fetcher as any);
    expect(resolved?.source).toBe('audius');
    expect(resolved?.audioUrl).toBe('https://audius-stream.example/track/a123');
    expect(resolved?.mirrors).toContain('https://mirror.example/track/a123');
    expect(resolved?.durationMs).toBe(214000);
  });

  it('accepts the first streamable Audius hit for a non-Latin title', async () => {
    const fetcher = stubFetch(() => audiusHit);
    const resolved = await resolveExternalStream('شدوا الركايب', 'عمر العبداللات', fetcher as any);
    expect(resolved?.source).toBe('audius');
    expect(resolved?.audioUrl).toBe('https://audius-stream.example/track/a123');
  });

  it('falls through to the iTunes preview when Audius has no match', async () => {
    const fetcher = stubFetch((url) =>
      url.includes('audius.co')
        ? { data: [] }
        : {
            results: [
              {
                trackId: 999,
                trackName: 'Shadows Fall',
                artistName: 'Test Artist',
                previewUrl: 'https://audio.itunes.apple.com/preview.mp3',
                trackTimeMillis: 30000,
              },
            ],
          },
    );
    const resolved = await resolveExternalStream('Moonlight Drive', 'Test Artist', fetcher as any);
    expect(resolved?.source).toBe('itunes');
    expect(resolved?.audioUrl).toBe('https://audio.itunes.apple.com/preview.mp3');
    expect(resolved?.durationMs).toBe(30000);
  });

  it('returns null when neither source has the song', async () => {
    const fetcher = stubFetch(() => ({ data: [], results: [] }));
    await expect(
      resolveExternalStream('No Such Song At All', 'Nobody', fetcher as any),
    ).resolves.toBeNull();
  });

  it('returns null when iTunes has no preview URL', async () => {
    const fetcher = stubFetch((url) =>
      url.includes('audius.co') ? { data: [] } : { results: [{ trackId: 1 }] },
    );
    await expect(
      resolveExternalStream('River Road', 'Test Artist', fetcher as any),
    ).resolves.toBeNull();
  });

  it('never throws when a host is unreachable, and still tries iTunes', async () => {
    const fetcher = stubFetch((url) => {
      if (url.includes('audius.co')) throw new Error('network down');
      return {
        results: [
          {
            trackId: 5,
            trackName: 'Shadows Fall',
            previewUrl: 'https://audio.itunes.apple.com/preview.mp3',
            trackTimeMillis: 30000,
          },
        ],
      };
    });
    const resolved = await resolveExternalStream('Northern Lights', 'Test Artist', fetcher as any);
    expect(resolved?.source).toBe('itunes');
  });

  it('returns null for an empty title without calling any host', async () => {
    const fetcher = stubFetch(() => ({ data: [] }));
    await expect(resolveExternalStream('   ', 'Anyone', fetcher as any)).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
