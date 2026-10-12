/**
 * `favorites` — the set of favorited tracks, keyed by `video_id`.
 *
 * Favoriting a song that the database has never seen also upserts its
 * metadata, so the favorites list stays fully readable offline.
 */
import { apiGet } from '../../api';
import type { PlaylistSong, Track } from '../../types/models';
import { normalizeTrack } from '../../utils/track';
import { getDb } from '../connection';
import { getFlagsSnapshot, setFlag } from '../flags';
import { fallbackGet, fallbackSet, usingFallback } from './fallback';
import { getFeed } from './feed';
import { loadPlayback } from './playback';
import { mapSongRow, trackBindValues, UPSERT_TRACK_SQL, type SongRow } from './rows';
import { getTrack, upsertTrack } from './tracks';

const FAVORITE_SELECT = `
  SELECT t.*, d.audio_path,
         1 AS is_favorite
  FROM favorites f
  JOIN tracks t ON t.video_id = f.video_id
  LEFT JOIN downloads d ON d.video_id = t.video_id
`;

export async function isFavorite(videoId: string): Promise<boolean> {
  if (usingFallback) {
    return fallbackGet<string[]>('favoriteIds', []).includes(videoId);
  }
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    'SELECT COUNT(*) AS n FROM favorites WHERE video_id = $1',
    [videoId],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

/** Toggles and returns the **new** state. */
export async function toggleFavorite(track: Track): Promise<boolean> {
  const videoId = track.videoId;
  if (usingFallback) {
    const current = new Set(fallbackGet<string[]>('favoriteIds', []));
    const next = !current.has(videoId);
    if (next) {
      current.add(videoId);
      // Same contract as the SQLite path below: the metadata rides along
      // *before* the id lands, so the list never serves a bare-id row.
      // Never cement a placeholder (title == videoId) though — the list
      // heals it from the server instead. Best effort: a blocked
      // IndexedDB must not stop the heart itself.
      if (track.title && track.title !== videoId) {
        await upsertTrack(track).catch(() => {});
      }
    } else {
      current.delete(videoId);
    }
    fallbackSet('favoriteIds', [...current]);
    setFlag('favorite', videoId, next);
    return next;
  }

  const db = await getDb();
  const exists = await isFavorite(videoId);
  if (exists) {
    await db.execute('DELETE FROM favorites WHERE video_id = $1', [videoId]);
    setFlag('favorite', videoId, false);
    return false;
  }
  await db.execute(UPSERT_TRACK_SQL, trackBindValues(track));
  await db.execute(
    'INSERT INTO favorites (video_id, created_at) VALUES ($1, $2)',
    [videoId, Date.now()],
  );
  setFlag('favorite', videoId, true);
  return true;
}

/* ── fallback metadata resolution ───────────────────────────────────────── */

/**
 * Last-resort row for a favorite whose metadata cannot be found anywhere:
 * the id itself. Still playable — every lookup keys on `videoId`.
 */
function placeholderTrack(videoId: string): Track {
  return {
    videoId,
    title: videoId,
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

/** One favorites row: the track's fields plus the two list flags. */
function toSong(track: Track): PlaylistSong {
  return {
    ...track,
    isFavorite: true,
    isDownloaded: getFlagsSnapshot().downloaded.has(track.videoId),
    audioPath: null,
  };
}

/** In-flight heals — StrictMode's double mount must not fire two requests. */
const healing = new Map<string, Promise<Track | null>>();

/**
 * Server metadata for a favorite the local stores cannot answer (favorites
 * saved by older builds), persisted on success so every later open — and
 * every offline one — reads it from storage instead.
 */
async function healTrack(videoId: string): Promise<Track | null> {
  const inflight = healing.get(videoId);
  if (inflight) return inflight;

  const task = (async () => {
    try {
      const track = normalizeTrack(await apiGet(`/browsing/track/${videoId}`));
      // An unknown id answers with an empty skeleton — not worth keeping.
      if (!track || !track.title || track.title === 'Unknown title') return null;
      // Persist for every later open; if storage is blocked this session
      // still shows the row — losing it to a null would be worse.
      await upsertTrack(track).catch(() => {});
      return track;
    } catch {
      return null; // offline / server down — the caller keeps the placeholder
    }
  })();

  healing.set(videoId, task);
  try {
    return await task;
  } finally {
    healing.delete(videoId);
  }
}

/**
 * Metadata the player and the home feed already hold — the playback
 * snapshot's queue + history and the feed's recent/suggestions. Covers the
 * common "hearted while listening" case with no network at all.
 */
async function localTrackPool(ids: ReadonlySet<string>): Promise<Map<string, Track>> {
  const pool = new Map<string, Track>();
  const collect = (tracks: Track[] | null | undefined) => {
    for (const track of tracks ?? []) {
      // Placeholders (title == videoId) are never worth adopting — the
      // network heal is the only thing allowed to fill those rows in.
      if (track?.videoId && track.title && track.title !== track.videoId && ids.has(track.videoId)) {
        if (!pool.has(track.videoId)) pool.set(track.videoId, track);
      }
    }
  };
  try {
    const [playback, feed] = await Promise.all([loadPlayback(), getFeed()]);
    collect(playback?.queue);
    collect(playback?.history);
    collect(feed.recent);
    collect(feed.suggestions);
  } catch {
    /* a pool failure only means the network heal runs instead */
  }
  return pool;
}

/**
 * Favorited songs as a playlist-like list.
 *
 * The SQLite path joins the `tracks` table — metadata written when the song
 * was favorited. The browser fallback has no such guarantee (older builds
 * stored bare ids), so rows are resolved through what is already known
 * locally (the track store, then the queue/history and home feed) and, for
 * anything still missing, one persisted `/browsing/track` heal, a few ids
 * at a time. Only when every source fails — offline, id unknown — does a
 * row fall back to the placeholder.
 *
 * `onUpdate` receives the list as soon as the local pass is done and again
 * after each heal batch, so callers can paint rows progressively instead of
 * waiting out the network.
 */
export async function listFavorites(
  onUpdate?: (rows: PlaylistSong[]) => void,
): Promise<PlaylistSong[]> {
  if (usingFallback) {
    const ids = fallbackGet<string[]>('favoriteIds', []);

    // 1 — metadata stored when the song was favorited (current builds) or
    //     downloaded: one cheap local read per id. A record whose title is
    //     just the videoId is a cemented placeholder — treat it as missing
    //     so the heal below replaces it with real metadata.
    const resolved = new Map<string, Track>();
    const known = await Promise.all(ids.map((videoId) => getTrack(videoId)));
    let pending: string[] = [];
    known.forEach((track, index) => {
      const videoId = ids[index];
      if (track && track.title && track.title !== videoId) resolved.set(videoId, track);
      else pending.push(videoId);
    });

    // 2 — scavenged from the playback snapshot and the home feed; what is
    //     found is frozen into the track store for every later open.
    if (pending.length) {
      const pool = await localTrackPool(new Set(pending));
      const scavenged: Track[] = [];
      const stillMissing: string[] = [];
      for (const videoId of pending) {
        const track = pool.get(videoId);
        if (track) {
          resolved.set(videoId, track);
          scavenged.push(track);
        } else {
          stillMissing.push(videoId);
        }
      }
      await Promise.all(scavenged.map((track) => upsertTrack(track).catch(() => {})));
      pending = stillMissing;
    }

    const build = (): PlaylistSong[] =>
      ids.map((videoId) => toSong(resolved.get(videoId) ?? placeholderTrack(videoId)));

    // Fast first paint: everything local is in place, the rest of the rows
    // show their id until the heal fills them in below.
    onUpdate?.(build());

    // 3 — server metadata for the remainder, batched so a big list cannot
    //     stampede the backend (each answer is cached there a week).
    for (let i = 0; i < pending.length; i += 4) {
      await Promise.all(
        pending.slice(i, i + 4).map(async (videoId) => {
          const track = await healTrack(videoId);
          if (track) resolved.set(videoId, track);
        }),
      );
      onUpdate?.(build());
    }

    return build();
  }
  const db = await getDb();
  const rows = await db.select<SongRow[]>(
    `${FAVORITE_SELECT} ORDER BY f.created_at DESC`,
  );
  const songs = rows.map(mapSongRow);
  onUpdate?.(songs);
  return songs;
}

export async function favoriteIds(): Promise<string[]> {
  if (usingFallback) return fallbackGet<string[]>('favoriteIds', []);
  const db = await getDb();
  const rows = await db.select<{ video_id: string }[]>(
    'SELECT video_id FROM favorites',
  );
  return rows.map((row) => row.video_id);
}
