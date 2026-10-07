import type { LyricLine } from './services/lyricsService';

/** An artist credited on a track. */
export interface Artist {
  name: string;
  id?: string | null;
}

/** The normalized track shape every screen renders. */
export interface Track {
  videoId: string;
  title: string;
  artists: Artist[];
  artist: string; // joined display string
  album: { name: string; id: string | null } | null;
  albumName: string;
  duration: string | null;
  durationSeconds: number | null;
  artwork: string | null;
  year: string | null;
  isExplicit: boolean;
  playlistId: string | null;
}

/** Lyrics as the backend returns them (synced and/or unsynced). */
export interface LyricPayload {
  synced: LyricLine[] | null;
  unsynced: string | null;
  source: string | null;
}

/** Track detail metadata (watch page / downloads). */
export interface TrackMeta {
  title?: string;
  album?: { name: string; thumbnails?: unknown[] };
  year?: string;
  genre?: string;
  lyrics?: LyricPayload;
  thumbnails?: unknown[];
}
