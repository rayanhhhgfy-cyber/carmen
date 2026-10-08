/**
 * Shared domain model for the whole app.
 *
 * Everything downstream (repos, hooks, player, UI) speaks these types — the
 * raw API payloads only ever appear inside `utils/track` normalizers and
 * repository row mappers.
 */

/** One entry of the `artists` array — the API is inconsistent about shape. */
export type Artist = string | { name: string; id?: string | null };

export interface Thumbnail {
  url: string;
  width?: number;
  height?: number;
}

/** Normalized track: the shape every list and control in the UI consumes. */
export interface Track {
  videoId: string;
  title: string;
  artists: Artist[];
  artist: string;
  album: { name: string; id: string | null } | null;
  albumName: string;
  duration: string | null;
  durationSeconds: number | null;
  artwork: string | null;
  year: string | null;
  /** `YYYY-MM-DD` or `YYYY` when the API provides it (sortable). */
  releaseDate: string | null;
  isExplicit: boolean;
  playlistId: string | null;
}

/** Raw API item — intentionally loose, the API is a JSON blob soup. */
export type RawTrack = Record<string, unknown>;

export interface LyricLine {
  timeMs: number;
  endTimeMs?: number;
  text: string;
}

export interface TrackLyrics {
  browseId?: string | null;
  synced: LyricLine[] | null;
  unsynced: string | null;
  source: string | null;
}

/** Enriched `/browsing/track/{id}` payload. */
export interface TrackMeta {
  videoId?: string;
  title?: string;
  artists?: Artist[];
  album?: string | { name?: string; id?: string | null; thumbnails?: Thumbnail[] };
  year?: string;
  genre?: string;
  duration?: string;
  duration_seconds?: number;
  thumbnails?: Thumbnail[];
  artwork?: string | null;
  lyrics?: TrackLyrics | null;
  playlistId?: string | null;
  [key: string]: unknown;
}

export type RepeatMode = 'off' | 'all' | 'one';

/** Persisted queue/history/seek position — restored on startup. */
export interface PlaybackSnapshot {
  queue: Track[];
  history: Track[];
  currentVideoId: string | null;
  positionMs: number;
  shuffle: boolean;
  repeat: RepeatMode;
  updatedAt: number;
}

export interface Playlist {
  id: number;
  name: string;
  description: string;
  coverVideoId: string | null;
  isFavorite: boolean;
  position: number;
  trackCount: number;
  createdAt: number;
  updatedAt: number;
}

/** A downloaded track joined with its file locations on disk. */
export interface DownloadedSong extends Track {
  audioPath: string;
  artworkPath: string | null;
  lyricsPath: string | null;
  lyricsSynced: boolean;
  bytes: number | null;
  downloadedAt: number;
  isFavorite: boolean;
}

/**
 * Any track as listed inside a playlist / the favorites smart list: knows
 * whether it is downloaded (playable offline) and whether it is a favorite.
 */
export interface PlaylistSong extends Track {
  isFavorite: boolean;
  isDownloaded: boolean;
  audioPath: string | null;
}

/** Lyrics provider selector — `auto` follows the backend's resolution chain. */
export type LyricsProvider =
  | 'auto'
  | 'lrclib'
  | 'musixmatch'
  | 'netease'
  | 'megalobiz'
  | 'genius';

export const LYRICS_PROVIDERS: { id: LyricsProvider; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'lrclib', label: 'LRCLIB' },
  { id: 'musixmatch', label: 'Musixmatch' },
  { id: 'netease', label: 'NetEase' },
  { id: 'megalobiz', label: 'Megalobiz' },
  { id: 'genius', label: 'Genius' },
];

export type ThemeMode = 'light' | 'dark' | 'system';
export type FontId = 'alexandria' | 'cairo' | 'system';

/** Everything the Settings screen can change. Persisted in SQLite. */
export interface AppSettings {
  themeMode: ThemeMode;
  accent: string;
  adaptiveAccent: boolean;
  font: FontId;
  lyricsProvider: LyricsProvider;
  /** Optional override of the FastAPI backend URL (empty = bundled default). */
  apiBase: string;
  /**
   * Low battery mode — no artwork-derived theme, white accent, no blur /
   * ambient effects: trade visual richness for a lighter, power-saving
   * render load. The manual toggle; the mode can also switch itself on
   * automatically below 20% battery (see `settings/battery.ts`).
   */
  lowBatteryMode: boolean;
  /**
   * Animated album artwork — covers that move in the Now Playing screen,
   * resolved through Apple's iTunes / amp-api catalogue (see
   * `artwork/motion.ts`): the whole card on desktop, only the lyrics page
   * on a phone. On by default; low battery mode switches it off on top of
   * this toggle.
   */
  animatedArtwork: boolean;
  /**
   * Blur & glass effects — backdrop blur on the navigation and player
   * surfaces, accent glows and the ambient artwork wash. Off gives flat,
   * lighter surfaces. Low battery mode forces them off on top of this
   * toggle (see `useEffectsEnabled`).
   */
  blurEffects: boolean;
  /**
   * Artwork background — the ambient wash that tints the whole app with
   * the colors of the playing artwork (see `AmbientBackground`). Off keeps
   * the plain theme background. Low battery mode hides it too.
   */
  artworkBackground: boolean;
}

export type SettingsKey = keyof AppSettings;
