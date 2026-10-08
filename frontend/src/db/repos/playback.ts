/**
 * `playback_state` — the resume-where-you-left-off contract.
 *
 * One row (id = 1) holding the queue, the history, the active track and the
 * exact playhead position. Written by `player/persistence` on a debounce and
 * restored during bootstrap.
 */
import type { PlaybackSnapshot } from '../../types/models';
import { fromJson, getDb, toBool, toJson } from '../connection';
import { fallbackGet, fallbackSet, usingFallback } from './fallback';

const EMPTY: PlaybackSnapshot = {
  queue: [],
  history: [],
  currentVideoId: null,
  positionMs: 0,
  shuffle: false,
  repeat: 'off',
  updatedAt: 0,
};

interface PlaybackRow {
  queue_json: string;
  history_json: string;
  current_video_id: string | null;
  position_ms: number;
  shuffle: number;
  repeat: string;
  updated_at: number;
}

export async function savePlayback(snapshot: PlaybackSnapshot): Promise<void> {
  const normalized: PlaybackSnapshot = { ...snapshot, updatedAt: Date.now() };
  if (usingFallback) {
    fallbackSet('playback', normalized);
    return;
  }
  const db = await getDb();
  await db.execute(
    `INSERT INTO playback_state
       (id, queue_json, history_json, current_video_id, position_ms, shuffle, repeat, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(id) DO UPDATE SET
       queue_json = excluded.queue_json,
       history_json = excluded.history_json,
       current_video_id = excluded.current_video_id,
       position_ms = excluded.position_ms,
       shuffle = excluded.shuffle,
       repeat = excluded.repeat,
       updated_at = excluded.updated_at`,
    [
      toJson(normalized.queue),
      toJson(normalized.history),
      normalized.currentVideoId,
      Math.round(normalized.positionMs),
      normalized.shuffle ? 1 : 0,
      normalized.repeat,
      normalized.updatedAt,
    ],
  );
}

export async function loadPlayback(): Promise<PlaybackSnapshot | null> {
  if (usingFallback) {
    const value = fallbackGet<PlaybackSnapshot | null>('playback', null);
    return value && typeof value === 'object' ? value : null;
  }
  const db = await getDb();
  const rows = await db.select<PlaybackRow[]>(
    'SELECT * FROM playback_state WHERE id = 1',
  );
  const row = rows[0];
  if (!row) return null;

  const repeat =
    row.repeat === 'all' || row.repeat === 'one' ? row.repeat : 'off';

  return {
    queue: fromJson(row.queue_json, []),
    history: fromJson(row.history_json, []),
    currentVideoId: row.current_video_id,
    positionMs: Number(row.position_ms) || 0,
    shuffle: toBool(row.shuffle),
    repeat,
    updatedAt: Number(row.updated_at) || 0,
  };
}

export async function clearPlayback(): Promise<void> {
  if (usingFallback) {
    fallbackSet('playback', null);
    return;
  }
  const db = await getDb();
  await db.execute('DELETE FROM playback_state WHERE id = 1');
}
