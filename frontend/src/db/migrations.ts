/**
 * SQLite migrations for `carmen.db`.
 *
 * Migrations are plain SQL, versioned, and applied in order by the runner in
 * `connection.ts`. Never edit an already-shipped migration — append a new one.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
      CREATE TABLE tracks (
        video_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL DEFAULT '',
        artists_json TEXT NOT NULL DEFAULT '[]',
        album TEXT NOT NULL DEFAULT '',
        album_id TEXT,
        duration_seconds INTEGER,
        artwork TEXT,
        year TEXT,
        release_date TEXT,                 -- 'YYYY-MM-DD' or 'YYYY', sortable
        is_explicit INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_tracks_title  ON tracks(title COLLATE NOCASE);
      CREATE INDEX idx_tracks_artist ON tracks(artist COLLATE NOCASE);
      CREATE INDEX idx_tracks_release ON tracks(release_date);

      CREATE TABLE downloads (
        video_id TEXT PRIMARY KEY REFERENCES tracks(video_id) ON DELETE CASCADE,
        audio_path TEXT NOT NULL,
        artwork_path TEXT,
        lyrics_path TEXT,
        lyrics_synced INTEGER NOT NULL DEFAULT 0,
        bytes INTEGER,
        downloaded_at INTEGER NOT NULL
      );
      CREATE INDEX idx_downloads_at ON downloads(downloaded_at DESC);

      CREATE TABLE playlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        cover_video_id TEXT,
        is_favorite INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE playlist_tracks (
        playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        video_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        added_at INTEGER NOT NULL,
        PRIMARY KEY (playlist_id, video_id)
      );
      CREATE INDEX idx_pt_pos ON playlist_tracks(playlist_id, position);

      CREATE TABLE favorites (
        video_id TEXT PRIMARY KEY REFERENCES tracks(video_id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE playback_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        queue_json TEXT NOT NULL DEFAULT '[]',
        history_json TEXT NOT NULL DEFAULT '[]',
        current_video_id TEXT,
        position_ms INTEGER NOT NULL DEFAULT 0,
        shuffle INTEGER NOT NULL DEFAULT 0,
        repeat TEXT NOT NULL DEFAULT 'off',
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE feed_recent (
        video_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        played_at INTEGER NOT NULL
      );
      CREATE TABLE feed_suggestions (
        video_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `,
  },
];

/**
 * Split a migration script into single statements.
 *
 * Migration SQL never puts a semicolon inside a string literal, so a plain
 * split is safe — and running one statement at a time keeps the SQL plugin
 * (which prepares a single statement per call) happy.
 */
export function splitStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}
