/**
 * Playlists page — the Library's Playlists tab: a responsive grid of
 * playlist cards plus the create / rename / delete flows. Opening a card
 * swaps the whole Library content area for the detail view (see
 * `LibraryPage`), so coming back remounts this page and its data is fresh
 * again by construction. The tab bar owns the title; the "New playlist"
 * action sits on the summary line.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import MarqueeText from '../../components/MarqueeText';
import { Button, IconButton, Shimmer, Tooltip } from '../../components/ui';
import { Menu, MenuItem } from '../../components/ui/Overlay';
import { addLocalFiles, LOCAL_FILES_PLAYLIST_NAME } from '../../services/localFiles';
import {
  applyLibraryBackup,
  backupFileName,
  buildLibraryBackup,
  parseLibraryBackup,
  serializeLibraryBackup,
} from '../../utils/libraryBackup';
import { notify } from '../../utils/downloadsStore';
import { useFlags } from '../../db/flags';
import { useDownloads } from '../../hooks';
import {
  createPlaylist,
  deletePlaylist,
  listPlaylistTracks,
  listPlaylists,
  renamePlaylist,
} from '../../db/repos/playlists';
import type { Playlist } from '../../types/models';
import { cdnArtwork } from '../../utils/track';
import { ConfirmDialog, EmptyHint, PageSummary, PlaylistFormDialog } from './common';
import SpotifyImportDialog, { SpotifyMark } from './SpotifyImportDialog';
import { Artwork, EditIcon, MoreVertIcon, MusicNoteIcon, PlusIcon, TrashIcon } from './glyphs';

interface PlaylistsSectionProps {
  /** Called with the playlist id — the parent opens the detail view. */
  onOpen: (playlistId: number) => void;
}

interface FormTarget {
  mode: 'create' | 'rename';
  playlist: Playlist | null;
}

/** A parsed backup awaiting the restore confirmation, with its counts. */
interface PendingRestore {
  backup: ReturnType<typeof parseLibraryBackup>;
  playlists: number;
  favorites: number;
}

/** Entry counts of a parsed backup (top level, with a nested fallback). */
function backupCounts(backup: unknown): { playlists: number; favorites: number } {
  const root = (backup ?? {}) as Record<string, unknown>;
  const nested = (root.data ?? root.library ?? root) as Record<string, unknown>;
  return {
    playlists: Array.isArray(nested.playlists) ? nested.playlists.length : 0,
    favorites: Array.isArray(nested.favorites) ? nested.favorites.length : 0,
  };
}

export default function PlaylistsSection({ onOpen }: PlaylistsSectionProps) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [covers, setCovers] = useState<Record<number, string | null>>({});
  // Track ids per playlist, loaded in the same pass as the covers (the
  // tracks are already fetched for the first-track artwork) — the
  // "Downloaded" badge below needs them, and no extra query is spent.
  const [trackIds, setTrackIds] = useState<Record<number, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; playlist: Playlist } | null>(null);
  const [form, setForm] = useState<FormTarget | null>(null);
  const [deleteFor, setDeleteFor] = useState<Playlist | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [spotifyOpen, setSpotifyOpen] = useState(false);
  const [addingLocal, setAddingLocal] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<PendingRestore | null>(null);
  const [restoring, setRestoring] = useState(false);
  const localFilesRef = useRef<HTMLInputElement | null>(null);
  const restoreFileRef = useRef<HTMLInputElement | null>(null);
  // Live download state for the badges: flags for saved songs (earlier
  // sessions) plus session jobs for songs saved just now.
  const { jobs } = useDownloads();
  const flags = useFlags();

  /** Playlist list + cover artwork (explicit cover video → first track). */
  const load = useCallback(async () => {
    const lists = await listPlaylists();
    setPlaylists(lists);

    const entries: [number, string | null, string[]][] = await Promise.all(
      lists.map(async (playlist): Promise<[number, string | null, string[]]> => {
        // The badge needs every playlist's track ids, so the tracks are
        // fetched even when the cover is explicit (that path used to skip
        // the query and only the fallback path fetched).
        if (playlist.coverVideoId) {
          try {
            const songs = await listPlaylistTracks(playlist.id);
            return [playlist.id, cdnArtwork(playlist.coverVideoId), songs.map((song) => song.videoId)];
          } catch {
            return [playlist.id, cdnArtwork(playlist.coverVideoId), []];
          }
        }
        try {
          const songs = await listPlaylistTracks(playlist.id);
          return [playlist.id, songs[0]?.artwork ?? null, songs.map((song) => song.videoId)];
        } catch {
          return [playlist.id, null, []];
        }
      }),
    );
    const map: Record<number, string | null> = {};
    const idsMap: Record<number, string[]> = {};
    for (const [id, artwork, ids] of entries) {
      map[id] = artwork;
      idsMap[id] = ids;
    }
    setCovers(map);
    setTrackIds(idsMap);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .catch((loadError) => console.warn('[library] load playlists failed', loadError))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const handleCreate = async (name: string, description: string) => {
    await createPlaylist(name, description);
    await load();
  };

  const handleRename = async (name: string) => {
    if (!form?.playlist) return;
    await renamePlaylist(form.playlist.id, name);
    await load();
  };

  /* ── local audio files ─────────────────────────────────────────────── */

  const handleLocalFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || addingLocal) return;
    const picked = Array.from(files);
    setAddingLocal(true);
    try {
      const { added } = await addLocalFiles(picked);
      await load();
      notify(
        added > 0 ? 'success' : 'info',
        added > 0
          ? `${added} file${added === 1 ? '' : 's'} added to “${LOCAL_FILES_PLAYLIST_NAME}”`
          : 'No playable audio files were in that pick',
      );
    } catch {
      notify('error', 'Could not add those files — please try again.');
    } finally {
      setAddingLocal(false);
    }
  };

  /* ── library backup / restore ──────────────────────────────────────── */

  const handleBackup = async () => {
    try {
      const backup = await buildLibraryBackup();
      const blob = new Blob([serializeLibraryBackup(backup)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = backupFileName(new Date());
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      notify('success', 'Library backup downloaded');
    } catch {
      notify('error', 'Could not create the backup — please try again.');
    }
  };

  const handleRestoreFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const backup = parseLibraryBackup(text);
      setPendingRestore({ backup, ...backupCounts(backup) });
    } catch (parseError) {
      notify(
        'error',
        parseError instanceof Error && parseError.message
          ? parseError.message
          : 'That file is not a valid Carmen library backup.',
      );
    }
  };

  const handleRestore = async () => {
    if (!pendingRestore || restoring) return;
    setRestoring(true);
    try {
      const result = await applyLibraryBackup(pendingRestore.backup);
      setPendingRestore(null);
      await load();
      notify(
        'success',
        `Restored ${result.playlists} playlist${result.playlists === 1 ? '' : 's'} and ${result.favorites} favorite${result.favorites === 1 ? '' : 's'}`,
      );
    } catch {
      notify('error', 'Could not restore that backup — please try again.');
    } finally {
      setRestoring(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteFor || deleting) return;
    setDeleting(true);
    try {
      await deletePlaylist(deleteFor.id);
      setDeleteFor(null);
      await load();
    } finally {
      setDeleting(false);
    }
  };

  const empty = !loading && playlists.length === 0;

  return (
    <section>
      <PageSummary
        action={
          <>
            <Button
              variant="contained"
              aria-label="Import a playlist"
              startIcon={<SpotifyMark size={18} />}
              onClick={() => setSpotifyOpen(true)}
              className="!bg-[#1DB954] !text-black hover:!bg-[#1ed760]"
            >
              {/* Short label on narrow phones so the actions fit. */}
              <span aria-hidden className="hidden min-[420px]:inline">Import a playlist</span>
              <span aria-hidden className="min-[420px]:hidden">Import</span>
            </Button>
            <Button
              variant="text"
              className="border border-accent/50"
              startIcon={<MusicNoteIcon />}
              disabled={addingLocal}
              onClick={() => localFilesRef.current?.click()}
            >
              {addingLocal ? 'Adding…' : 'Add local files'}
            </Button>
            {/* MIGRATION: the kit Button has no `outlined` variant — the text
            variant plus a border class is the closest match. */}
            <Button
              variant="text"
              className="border border-accent/50"
              startIcon={<PlusIcon />}
              onClick={() => setForm({ mode: 'create', playlist: null })}
            >
              New playlist
            </Button>
          </>
        }
      >
        {loading
          ? 'Loading…'
          : `${playlists.length} playlist${playlists.length === 1 ? '' : 's'}`}
      </PageSummary>

      {/* Compact library backup / restore, in the same toolbar area. */}
      <div className="mb-3 flex items-center gap-1">
        <span className="mr-1 text-xs leading-5 text-muted">Library backup:</span>
        <Button variant="text" className="!px-2 !py-0.5 !text-xs max-sm:min-h-11" onClick={() => void handleBackup()}>
          Backup
        </Button>
        <Button
          variant="text"
          className="!px-2 !py-0.5 !text-xs max-sm:min-h-11"
          onClick={() => restoreFileRef.current?.click()}
        >
          Restore
        </Button>
      </div>

      {loading && playlists.length === 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
          {[0, 1, 2, 3].map((index) => (
            <Shimmer key={index} variant="rounded" height={196} />
          ))}
        </div>
      ) : empty ? (
        <EmptyHint
          title="No playlists yet"
          hint="Create one to group songs from your downloads, favorites or the web."
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
          {playlists.map((playlist) => {
            // Same rule as the detail view's button: every track saved
            // (catalogue flag or a just-finished session job), and never
            // for an empty playlist or one whose tracks failed to load.
            const ids = trackIds[playlist.id];
            const fullyDownloaded = Boolean(
              ids &&
                ids.length > 0 &&
                ids.every((id) => flags.downloaded.has(id) || jobs[id]?.status === 'done'),
            );
            return (
            <div key={playlist.id} className="relative">
              <button
                type="button"
                onClick={() => onOpen(playlist.id)}
                className={
                  // No automatic minimum: a long playlist name clips +
                  // scrolls inside the cell instead of inflating the card.
                  // The stretch must be explicit: WebKit's UA sheet pins
                  // align-items: flex-start on <button> (older macOS
                  // WKWebView would size the text cell to the whole name).
                  'm-0 flex w-full min-w-0 cursor-pointer flex-col items-stretch gap-2 border-0 bg-transparent p-0 text-left hover:[&_.playlist-art]:[transform:scale(1.03)]'
                }
              >
                <Artwork
                  className="playlist-art"
                  src={covers[playlist.id] ?? null}
                  alt=""
                  icon={MusicNoteIcon}
                  iconSize={44}
                  style={{
                    width: '100%',
                    aspectRatio: '1 / 1',
                    borderRadius: 28,
                    boxShadow: 'var(--shadow-elev-1)',
                    transition: 'transform 220ms ease',
                  }}
                />
                <div className="w-full min-w-0">
                  <MarqueeText text={playlist.name} variant="body2" sx={{ fontWeight: 600 }} />
                  <span className="block text-xs leading-[1.4] text-muted">
                    {playlist.trackCount} song{playlist.trackCount === 1 ? '' : 's'}
                  </span>
                  {fullyDownloaded && (
                    <span className="block text-xs leading-[1.4] font-semibold text-accent">
                      Downloaded
                    </span>
                  )}
                </div>
              </button>

              {/* The kit Tooltip wraps its child in a `relative` span, so the
                  absolute anchoring moves onto an outer span (MUI's Tooltip
                  added no DOM node, and the button overlays the card corner). */}
              <span className="absolute right-[6px] top-[6px]">
                <Tooltip title="Playlist actions" placement="top">
                  <IconButton
                    size="small"
                    aria-label={`Actions for ${playlist.name}`}
                    onClick={(event) => setMenu({ anchor: event.currentTarget, playlist })}
                    className="h-[30px] w-[30px] bg-[rgba(0,0,0,0.45)] !p-0 !text-white hover:!bg-[rgba(0,0,0,0.65)]"
                  >
                    <MoreVertIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </Tooltip>
              </span>
            </div>
            );
          })}
        </div>
      )}

      {/* MIGRATION: `anchorOrigin` / `transformOrigin` dropped — the kit Menu
          positions itself from the anchor and flips when it would overflow. */}
      <Menu
        anchorEl={menu?.anchor ?? null}
        open={Boolean(menu)}
        onClose={() => setMenu(null)}
      >
        <MenuItem
          onClick={() => {
            if (menu) setForm({ mode: 'rename', playlist: menu.playlist });
            setMenu(null);
          }}
        >
          <EditIcon fontSize="small" />
          Rename
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menu) setDeleteFor(menu.playlist);
            setMenu(null);
          }}
        >
          <TrashIcon fontSize="small" />
          Delete
        </MenuItem>
      </Menu>

      <PlaylistFormDialog
        open={Boolean(form)}
        mode={form?.mode ?? 'create'}
        initialName={form?.playlist?.name ?? ''}
        initialDescription={form?.playlist?.description ?? ''}
        onSubmit={form?.mode === 'rename' ? handleRename : handleCreate}
        onClose={() => setForm(null)}
      />

      <ConfirmDialog
        open={deleteFor !== null}
        title="Delete playlist?"
        message={`“${deleteFor?.name ?? ''}” will be removed. The songs themselves stay in your library.`}
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onClose={() => setDeleteFor(null)}
      />

      <ConfirmDialog
        open={pendingRestore !== null}
        title="Restore library backup?"
        message={`This backup contains ${pendingRestore?.playlists ?? 0} playlist${pendingRestore?.playlists === 1 ? '' : 's'} and ${pendingRestore?.favorites ?? 0} favorite${pendingRestore?.favorites === 1 ? '' : 's'}. Restoring recreates those playlists in order and re-adds the favorites to your library.`}
        confirmLabel="Restore"
        busy={restoring}
        onConfirm={() => void handleRestore()}
        onClose={() => setPendingRestore(null)}
      />

      <SpotifyImportDialog
        open={spotifyOpen}
        onClose={() => setSpotifyOpen(false)}
        onOpenPlaylist={onOpen}
      />

      {/* Hidden pickers: local audio files + the backup JSON. The input
          value is reset on every change so the same files can be
          re-picked immediately. */}
      <input
        ref={localFilesRef}
        type="file"
        hidden
        accept="audio/*,.mp3,.m4a,.flac,.wav,.ogg,.opus"
        multiple
        onChange={(event) => {
          void handleLocalFiles(event.target.files);
          event.target.value = '';
        }}
      />
      <input
        ref={restoreFileRef}
        type="file"
        hidden
        accept="application/json,.json"
        onChange={(event) => {
          void handleRestoreFile(event.target.files?.[0] ?? null);
          event.target.value = '';
        }}
      />
    </section>
  );
}
