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
  /** Per-word karaoke stamps, when the source carries them (enhanced LRC). */
  words?: LyricWord[];
}

/** One karaoke word with explicit stamps (enhanced LRC), in milliseconds. */
export interface LyricWord {
  text: string;
  startMs: number;
  endMs: number;
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
/** Text size of the lyrics inside the Now Playing card. */
export type LyricsSize = 'default' | 'large' | 'veryLarge';
/** Size of the album cover (thumbnail) inside the Now Playing card. */
export type CoverSize = 'default' | 'large' | 'veryLarge';
/**
 * Where an enabled animated artwork plays: `default` follows the device —
 * the whole player card on desktop, the lyrics background on a phone —
 * while the explicit values pin one surface on every device and
 * `thumbnail` animates the cover tile itself instead of any background.
 */
export type ArtworkPlacement = 'default' | 'lyrics' | 'player' | 'thumbnail';

/** Everything the Settings screen can change. Persisted in SQLite. */
export interface AppSettings {
  themeMode: ThemeMode;
  accent: string;
  adaptiveAccent: boolean;
  font: FontId;
  lyricsProvider: LyricsProvider;
  /** Lyrics text size — the synced rows and the plain-text fallback alike. */
  lyricsSize: LyricsSize;
  /**
   * Word-by-word karaoke — inside the active line every word lights up as
   * the playhead passes it. Words use the source's own stamps when it has
   * them (enhanced LRC), otherwise the line's duration is spread evenly
   * across its words.
   */
  karaokeWords: boolean;
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
   * Where animated artwork plays (Settings → Animated artwork placement).
   * `default` follows the device (whole card on desktop, lyrics background
   * on a phone); `lyrics` / `player` pin one surface everywhere;
   * `thumbnail` animates the cover tile itself instead of a background.
   */
  animatedArtworkPlacement: ArtworkPlacement;
  /**
   * Album-cover size in the Now Playing card — the square thumbnail's
   * width cap, stepped up from the default ladder by Large / Very large.
   */
  coverSize: CoverSize;
  /**
   * Cinematic mode (desktop) — full screen drops every affordance: no
   * buttons, no scrubber, no tabs — just the song details and the lyrics
   * over the artwork backdrop. Escape leaves full screen again.
   */
  cinematicMode: boolean;
  /**
   * Keep the album cover on the left inside cinematic mode (default).
   * Off = the details and the lyrics take the full width instead.
   */
  cinematicCover: boolean;
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
  /**
   * Lock-screen lyrics — mirrors the currently sung line into the OS media
   * widget's `metadata.artist`, so the lock screen / Control Center / car
   * display shows what is playing right now (the title keeps the track
   * name). Updates fire only when the active synced line changes, never per
   * playhead tick (see `services/mediaSession/lockScreenLyrics`).
   */
  lockScreenLyrics: boolean;
  /**
   * Smart downloads — once the listener is halfway through a song, it is
   * saved to the device automatically (unless it already lives there), so a
   * favorite keeps playing through a dead connection. The trigger lives in
   * `offline/smartDownload.ts`.
   */
  smartDownload: boolean;
  /**
   * Smart downloads (library edition, `services/smartDownloads.ts`) —
   * separate toggles, both off by default: auto-download liked songs, and
   * auto-download playlists marked favourite. Runs on launch, when a
   * favourite is added, and when a toggle is switched on, through the
   * existing download pipeline only.
   */
  smartDownloadLiked: boolean;
  smartDownloadFavPlaylists: boolean;
  /**
   * Wi-Fi-only gate, best effort — the web cannot reliably tell Wi-Fi
   * from cellular (see the header of `services/smartDownloads.ts`):
   * `navigator.connection` is the only signal, it is missing in some
   * browsers, and an unknown type is treated as metered. Default on.
   */
  smartDownloadWifiOnly: boolean;
  /**
   * Explicit opt-in to auto-download on a metered-looking connection.
   * Default off — without it, a metered verdict blocks the run.
   */
  smartDownloadAllowMetered: boolean;
  /**
   * Favourite-playlist ids the user excluded from auto-download. A
   * playlist on this list is never auto-downloaded, however it is
   * favourited. Stored as a JSON array.
   */
  smartDownloadExcludedPlaylists: number[];
}

export type SettingsKey = keyof AppSettings;
