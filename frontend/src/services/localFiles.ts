/**
 * Local audio files — play files picked from the device, persisted.
 *
 * A picked file becomes a first-class offline song with zero schema
 * change (see FEATURE_PORT_LOG, item 6): its bytes are written through
 * `offline/storage.writeBinary` into the song folder, it is registered
 * as a download record (`insertDownload` + `markDownloaded` + the
 * downloaded flag — the exact completion path of `utils/downloads.ts`),
 * and it joins the "Local Files" playlist. Playback therefore goes
 * through the existing local-source ladder, the songs survive reloads,
 * and deleting the offline copy deletes the local file.
 *
 * Metadata is deliberately modest: the title comes from the file name,
 * the artist is "Local file", and the duration is probed best-effort
 * from an `<audio>` element (null when the probe fails — the player
 * learns the real length when the file plays).
 */
import { loadAppState, saveAppState } from '../db/repos/appState';
import { setFlag } from '../db/flags';
import { insertDownload } from '../db/repos/downloads';
import {
  addTrackToPlaylist,
  createPlaylist,
  getPlaylist,
  listPlaylists,
} from '../db/repos/playlists';
import { markDownloaded } from '../offline/source';
import { songFolder, writeBinary } from '../offline/storage';
import type { Track } from '../types/models';
import { formatTime } from '../utils/format';

export const LOCAL_FILES_PLAYLIST_NAME = 'Local Files';

const LOCAL_FILES_PLAYLIST_ID_KEY = 'localFilesPlaylistId';
const LOCAL_ARTIST = 'Local file';

const AUDIO_EXTENSIONS = new Set([
  'mp3', 'm4a', 'wav', 'ogg', 'opus', 'flac', 'webm', 'aac',
  'm4b', 'aif', 'aiff', 'mid', 'midi',
]);

const EXTENSION_BY_MIME: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/webm': 'webm',
  'audio/aac': 'aac',
};

/* ── file facts ───────────────────────────────────────────────────────── */

function fileExtension(file: File): string {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(file.name || '');
  return match?.[1] ? match[1].toLowerCase() : '';
}

/** Audio by MIME type, or — pickers often report none — by extension. */
function isAudioFile(file: File): boolean {
  if (file.type && file.type.startsWith('audio/')) return true;
  return AUDIO_EXTENSIONS.has(fileExtension(file));
}

function storedExtension(file: File): string {
  const ext = fileExtension(file);
  if (ext) return ext;
  return EXTENSION_BY_MIME[(file.type || '').toLowerCase()] ?? 'm4a';
}

/** "01_my-song (live).mp3" → "01 my song (live)". */
function titleFromFileName(name: string): string {
  const stem = (name || '').replace(/\.[^.]+$/, '');
  const title = stem.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return title || 'Untitled';
}

function newLocalVideoId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  const uuid =
    cryptoObj && typeof cryptoObj.randomUUID === 'function'
      ? cryptoObj.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random()
          .toString(36)
          .slice(2)}`;
  return `local-${uuid}`;
}

/** Best-effort duration probe: an `<audio>` metadata load, 3 s budget. */
function probeDurationSeconds(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    let url: string;
    try {
      url = URL.createObjectURL(file);
    } catch {
      resolve(null);
      return;
    }
    const audio = document.createElement('audio');
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timer);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute('src');
      URL.revokeObjectURL(url);
    };
    function done(value: number | null) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    }
    const timer = window.setTimeout(() => done(null), 3000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const seconds = audio.duration;
      done(typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds : null);
    };
    audio.onerror = () => done(null);
    audio.src = url;
  });
}

/* ── the "Local Files" playlist ───────────────────────────────────────── */

/**
 * The persisted Local Files playlist id, when it still exists. The id is
 * remembered in app state, but the playlist row is the authority — a
 * deleted playlist is re-found by name or recreated by the caller.
 */
async function findLocalFilesPlaylistId(): Promise<number | null> {
  const stored = await loadAppState<number | null>(LOCAL_FILES_PLAYLIST_ID_KEY, null);
  if (typeof stored === 'number' && (await getPlaylist(stored))) return stored;
  const byName = (await listPlaylists()).find(
    (playlist) => playlist.name === LOCAL_FILES_PLAYLIST_NAME,
  );
  if (byName) {
    await saveAppState(LOCAL_FILES_PLAYLIST_ID_KEY, byName.id);
    return byName.id;
  }
  return null;
}

async function ensureLocalFilesPlaylistId(): Promise<number> {
  const existing = await findLocalFilesPlaylistId();
  if (existing !== null) return existing;
  const id = await createPlaylist(
    LOCAL_FILES_PLAYLIST_NAME,
    'Audio files added from this device',
  );
  await saveAppState(LOCAL_FILES_PLAYLIST_ID_KEY, id);
  return id;
}

/* ── import ───────────────────────────────────────────────────────────── */

/**
 * Persist picked audio files as offline songs in the Local Files
 * playlist. Non-audio picks are skipped; a file that fails to store is
 * skipped too, unless every candidate failed — then the first error is
 * thrown so the caller can say so instead of reporting a silent no-op.
 *
 * Returns how many files were added and the Local Files playlist id
 * (`-1` when nothing was addable and no such playlist exists yet).
 */
export async function addLocalFiles(
  files: File[],
): Promise<{ added: number; playlistId: number }> {
  const candidates = (files ?? []).filter(isAudioFile);
  if (!candidates.length) {
    return { added: 0, playlistId: (await findLocalFilesPlaylistId()) ?? -1 };
  }

  const playlistId = await ensureLocalFilesPlaylistId();
  let added = 0;
  let firstError: unknown = null;

  for (const file of candidates) {
    try {
      const videoId = newLocalVideoId();
      const folder = await songFolder(videoId);
      if (!folder) throw new Error('Local storage is unavailable');

      const bytes = new Uint8Array(await file.arrayBuffer());
      const audioPath = `${folder}/audio.${storedExtension(file)}`;
      await writeBinary(audioPath, bytes);

      const probed = await probeDurationSeconds(file).catch(() => null);
      const durationSeconds = probed !== null ? Math.round(probed) : null;
      const track: Track = {
        videoId,
        title: titleFromFileName(file.name),
        artists: [LOCAL_ARTIST],
        artist: LOCAL_ARTIST,
        album: null,
        albumName: '',
        duration: durationSeconds !== null ? formatTime(durationSeconds) : null,
        durationSeconds,
        artwork: null,
        year: null,
        releaseDate: null,
        isExplicit: false,
        playlistId: null,
      };

      // The download pipeline's completion path, verbatim: the SQLite /
      // IndexedDB record, the in-memory playback record, and the flag.
      await insertDownload({
        track,
        audioPath,
        artworkPath: null,
        lyricsPath: null,
        lyricsSynced: false,
        bytes: file.size,
      });
      markDownloaded({
        videoId,
        audioPath,
        artworkPath: null,
        lyricsPath: null,
        lyricsSynced: false,
        downloadedAt: Date.now(),
      });
      setFlag('downloaded', videoId, true);

      await addTrackToPlaylist(playlistId, track);
      added += 1;
    } catch (error) {
      if (firstError === null) firstError = error;
    }
  }

  if (added === 0 && firstError !== null) throw firstError;
  return { added, playlistId };
}
