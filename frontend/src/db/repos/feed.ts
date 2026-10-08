/**
 * `feed_recent` / `feed_suggestions` — the home feed, now persisted in SQLite
 * instead of localStorage.
 *
 * Semantics are a port of the original `utils/library.js` store:
 * * recent  — a play moves the song to the front, capped at 10;
 * * suggestions — FIFO capped at 100, never containing a song that is already
 *   in "recently played".
 */
import type { Track } from '../../types/models';
import { fromJson, getDb, toJson } from '../connection';
import { fallbackGet, fallbackSet, usingFallback } from './fallback';
import { mapTrackRow, UPSERT_TRACK_SQL, trackBindValues, type TrackRow } from './rows';

export const RECENT_LIMIT = 10;
export const SUGGESTION_LIMIT = 100;
export const SUGGESTION_BATCH = 10;

export interface FeedSnapshot {
  recent: Track[];
  suggestions: Track[];
}

/** Monotonic counter so two writes in the same millisecond keep their order. */
async function nextStamp(db: Awaited<ReturnType<typeof getDb>>, table: string): Promise<number> {
  const rows = await db.select<{ max: number | null }[]>(
    `SELECT MAX(${table === 'feed_recent' ? 'played_at' : 'created_at'}) AS max FROM ${table}`,
  );
  const max = Number(rows[0]?.max ?? 0);
  return Math.max(Date.now(), max + 1);
}

export async function getFeed(): Promise<FeedSnapshot> {
  if (usingFallback) {
    return {
      recent: fallbackGet<Track[]>('feed.recent', []),
      suggestions: fallbackGet<Track[]>('feed.suggestions', []),
    };
  }
  const db = await getDb();
  const [recentRows, suggestionRows] = await Promise.all([
    db.select<TrackRow[]>(
      'SELECT t.* FROM feed_recent r JOIN tracks t ON t.video_id = r.video_id ORDER BY r.played_at DESC',
    ),
    db.select<TrackRow[]>(
      'SELECT t.* FROM feed_suggestions s JOIN tracks t ON t.video_id = s.video_id ORDER BY s.created_at DESC',
    ),
  ]);
  return {
    recent: recentRows.map(mapTrackRow),
    suggestions: suggestionRows.map(mapTrackRow),
  };
}

export async function recordPlay(track: Track): Promise<void> {
  if (usingFallback) {
    const recent = [track, ...fallbackGet<Track[]>('feed.recent', []).filter(
      (entry) => entry.videoId !== track.videoId,
    )].slice(0, RECENT_LIMIT);
    const suggestions = fallbackGet<Track[]>('feed.suggestions', []).filter(
      (entry) => entry.videoId !== track.videoId,
    );
    fallbackSet('feed.recent', recent);
    fallbackSet('feed.suggestions', suggestions);
    return;
  }

  const db = await getDb();
  await db.execute(UPSERT_TRACK_SQL, trackBindValues(track));
  await db.execute('DELETE FROM feed_recent WHERE video_id = $1', [track.videoId]);
  await db.execute(
    'INSERT INTO feed_recent (video_id, payload_json, played_at) VALUES ($1, $2, $3)',
    [track.videoId, toJson(track), await nextStamp(db, 'feed_recent')],
  );
  await db.execute(
    `DELETE FROM feed_recent WHERE video_id NOT IN (
       SELECT video_id FROM feed_recent ORDER BY played_at DESC LIMIT $1
     )`,
    [RECENT_LIMIT],
  );
  // A song that just played is no longer a "suggestion".
  await db.execute('DELETE FROM feed_suggestions WHERE video_id = $1', [track.videoId]);
}

export async function addSuggestions(tracks: Track[]): Promise<void> {
  if (usingFallback) {
    const known = new Set([
      ...fallbackGet<Track[]>('feed.recent', []).map((track) => track.videoId),
      ...fallbackGet<Track[]>('feed.suggestions', []).map((track) => track.videoId),
    ]);
    const added = tracks.filter((track) => !known.has(track.videoId));
    if (!added.length) return;
    const suggestions = [
      ...added,
      ...fallbackGet<Track[]>('feed.suggestions', []),
    ].slice(0, SUGGESTION_LIMIT);
    fallbackSet('feed.suggestions', suggestions);
    return;
  }

  const db = await getDb();
  for (const track of tracks.slice(0, SUGGESTION_BATCH)) {
    await db.execute(UPSERT_TRACK_SQL, trackBindValues(track));
    const inRecent = await db
      .select<{ n: number }[]>('SELECT COUNT(*) AS n FROM feed_recent WHERE video_id = $1', [
        track.videoId,
      ])
      .then((rows) => Number(rows[0]?.n ?? 0));
    if (inRecent) continue;

    await db.execute('DELETE FROM feed_suggestions WHERE video_id = $1', [track.videoId]);
    await db.execute(
      'INSERT INTO feed_suggestions (video_id, payload_json, created_at) VALUES ($1, $2, $3)',
      [track.videoId, toJson(track), await nextStamp(db, 'feed_suggestions')],
    );
  }
  await db.execute(
    `DELETE FROM feed_suggestions WHERE video_id NOT IN (
       SELECT video_id FROM feed_suggestions ORDER BY created_at DESC LIMIT $1
     )`,
    [SUGGESTION_LIMIT],
  );
}

export async function clearFeed(): Promise<void> {
  if (usingFallback) {
    fallbackSet('feed.recent', []);
    fallbackSet('feed.suggestions', []);
    return;
  }
  const db = await getDb();
  await db.execute('DELETE FROM feed_recent');
  await db.execute('DELETE FROM feed_suggestions');
}
