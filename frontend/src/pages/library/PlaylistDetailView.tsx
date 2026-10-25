/**
 * Playlist detail — the in-page view the Library swaps to when a playlist
 * card is opened (no route change: `LibraryPage` holds the selection).
 *
 * Shows the cover, rename/delete controls, Play All / Shuffle All and the
 * ordered track rows with a per-track remove action.
 */
import { useCallback, useEffect, useState } from 'react';

import { Button, IconButton, Shimmer, Tooltip } from '../../components/ui';
import { ShareIcon } from '../../components/icons';
import {
  deletePlaylist,
  getPlaylist,
  listPlaylistTracks,
  moveTrackInPlaylist,
  removeTrackFromPlaylist,
  renamePlaylist,
} from '../../db/repos/playlists';
import { useDownloads } from '../../hooks';
import { useDragReorder } from '../../hooks/useDragReorder';
import { isDownloaded } from '../../offline/source';
import { usePlayer } from '../../player/PlayerContext';
import type { Playlist, PlaylistSong } from '../../types/models';
import { startPlaylistDownload } from '../../utils/downloads';
import { notify } from '../../utils/downloadsStore';
import { shuffleList } from '../../utils/library';
import { moveItem } from '../../utils/reorder';
import { cdnArtwork } from '../../utils/track';
import { ConfirmDialog, EmptyHint, PlaylistFormDialog } from './common';
import {
  ArrowBackIcon,
  Artwork,
  CheckCircleIcon,
  DownloadIcon,
  EditIcon,
  MusicNoteIcon,
  PlayArrowIcon,
  ShuffleIcon,
  TrashIcon,
} from './glyphs';
import SharePlaylistDialog from './SharePlaylistDialog';
import SongRow from './SongRow';

/** Six-dot grip — no grip glyph exists in the icon set, so it is drawn
 *  inline in the set's own idiom (24px grid, `currentColor` fill). */
function GripIcon() {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" aria-hidden focusable="false">
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  );
}

interface PlaylistDetailViewProps {
  playlistId: number;
  /** Leaves the detail view — the sections remount and reload behind us. */
  onBack: () => void;
}

export default function PlaylistDetailView({ playlistId, onBack }: PlaylistDetailViewProps) {
  const player = usePlayer();
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [songs, setSongs] = useState<PlaylistSong[]>([]);
  const [loading, setLoading] = useState(true);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { jobs } = useDownloads();

  const reload = useCallback(async () => {
    const [nextPlaylist, nextSongs] = await Promise.all([
      getPlaylist(playlistId),
      listPlaylistTracks(playlistId),
    ]);
    setPlaylist(nextPlaylist);
    setSongs(nextSongs);
    return nextPlaylist;
  }, [playlistId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    reload()
      .then((nextPlaylist) => {
        if (cancelled) return;
        // Deleted (from the grid or another window) — nothing to show here.
        if (!nextPlaylist) onBack();
        else setLoading(false);
      })
      .catch((loadError) => {
        console.warn('[library] load playlist failed', loadError);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload, onBack]);

  const handleRemove = async (videoId: string) => {
    try {
      await removeTrackFromPlaylist(playlistId, videoId);
      const nextPlaylist = await reload();
      if (!nextPlaylist) onBack();
    } catch (removeError) {
      console.warn('[library] remove from playlist failed', removeError);
    }
  };

  const handleRename = async (name: string) => {
    await renamePlaylist(playlistId, name);
    await reload();
  };

  const handleDelete = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await deletePlaylist(playlistId);
      onBack();
    } finally {
      setBusy(false);
    }
  };

  // ── Download all ────────────────────────────────────────────────────────
  // Same aggregation as CollectionPage: done jobs in the shared downloads
  // store plus what the offline catalogue already holds (a track saved in
  // an earlier session has no job anymore). When every track is saved,
  // the button gives way to a "Downloaded" label instead.
  const downloadedJobs = songs.filter(
    (song) => isDownloaded(song.videoId) || jobs[song.videoId]?.status === 'done',
  ).length;
  const downloadInFlight = songs.some((song) => jobs[song.videoId]?.status === 'running');
  const allDownloaded = songs.length > 0 && downloadedJobs === songs.length;

  const handleDownloadAll = () => {
    if (downloadInFlight || allDownloaded) return;
    const started = startPlaylistDownload(songs);
    if (started > 0) {
      notify('success', `Downloading ${started} track${started === 1 ? '' : 's'} from “${playlist?.name ?? 'playlist'}”`);
    } else {
      notify('info', 'Nothing new to download — every track is already saved or downloading');
    }
  };

  // ── Drag reorder ────────────────────────────────────────────────────────
  // Optimistic: the on-screen order flips the moment the handle is dropped,
  // then the existing repo call persists it. A failed save reloads the
  // stored order instead of leaving the wrong one on screen.
  const handleMoveSong = useCallback(
    (from: number, to: number) => {
      const moved = songs[from];
      if (!moved) return;
      setSongs((previous) => moveItem(previous, from, to));
      void (async () => {
        try {
          await moveTrackInPlaylist(playlistId, moved.videoId, to);
        } catch (moveError) {
          console.warn('[library] reorder playlist failed', moveError);
          await reload().catch(() => {});
        }
      })();
    },
    [songs, playlistId, reload],
  );

  const drag = useDragReorder({ itemCount: songs.length, onMove: handleMoveSong });

  const playAll = () => player.playAll(songs, 0);

  const shuffleAll = () => {
    if (!songs.length) return;
    // Start shuffled *and* keep the queue shuffling while it plays.
    if (!player.shuffle) player.toggleShuffle();
    player.playAll(shuffleList(songs), 0);
  };

  const cover =
    (playlist?.coverVideoId ? cdnArtwork(playlist.coverVideoId) : null) ??
    songs[0]?.artwork ??
    null;

  if (loading) {
    return (
      <section>
        <Shimmer variant="text" width={120} height={32} />
        <div className="mt-2 flex flex-col gap-6 sm:flex-row">
          <Shimmer variant="rounded" width={180} height={180} />
          <div className="flex-1">
            <Shimmer variant="text" width="55%" height={40} />
            <Shimmer variant="text" width="35%" />
            <Shimmer variant="text" width="70%" />
          </div>
        </div>
      </section>
    );
  }

  if (!playlist) {
    return (
      <section>
        <BackButton onBack={onBack} />
        <EmptyHint title="Playlist not found" hint="It may have been deleted." />
      </section>
    );
  }

  return (
    <section>
      <BackButton onBack={onBack} />

      <div className="mb-5 flex flex-col gap-6 sm:flex-row">
        <Artwork
          src={cover}
          alt=""
          icon={MusicNoteIcon}
          iconSize={56}
          className="w-[160px] sm:w-[180px] h-[160px] sm:h-[180px] mx-auto sm:mx-0"
          style={{
            borderRadius: 42,
            boxShadow: 'var(--shadow-elev-3)',
            flexShrink: 0,
          }}
        />

        <div className="min-w-0 flex-1 text-center sm:text-left">
          {/* MIGRATION: MUI's `overline` variant — not in the conventions
              table; hand-mapped (span, 12px, uppercase, 2.66 line-height,
              no letter-spacing since the app font is not Roboto). */}
          <span className="text-xs font-normal uppercase leading-[2.66] text-muted">
            Playlist
          </span>
          <h5 className="m-0 text-2xl font-extrabold">{playlist.name}</h5>
          {playlist.description && (
            <p className="m-0 mt-2 overflow-hidden whitespace-pre-line text-sm leading-[1.43] text-muted [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
              {playlist.description}
            </p>
          )}
          <span className="mt-[6px] block text-xs leading-[1.4] text-muted">
            {songs.length} track{songs.length === 1 ? '' : 's'}
          </span>

          <div className="mt-4 flex flex-wrap justify-center gap-2 gap-y-2 sm:justify-start">
            <Button variant="contained" startIcon={<PlayArrowIcon />} disabled={!songs.length} onClick={playAll}>
              Play all
            </Button>
            {/* MIGRATION: the kit Button has no `outlined` variant — the text
                variant plus a border class is the closest match. */}
            <Button
              variant="text"
              className="border border-accent/50"
              startIcon={<ShuffleIcon />}
              disabled={!songs.length}
              onClick={shuffleAll}
            >
              Shuffle all
            </Button>
            {songs.length > 0 && (
              <Button
                variant="text"
                className="border border-accent/50"
                startIcon={allDownloaded ? <CheckCircleIcon /> : <DownloadIcon />}
                disabled={downloadInFlight || allDownloaded}
                onClick={handleDownloadAll}
              >
                {downloadInFlight
                  ? `Downloading ${downloadedJobs}/${songs.length}`
                  : allDownloaded
                    ? 'Downloaded'
                    : 'Download all'}
              </Button>
            )}
            <Tooltip title="Share playlist">
              <IconButton
                aria-label="Share playlist"
                disabled={!songs.length}
                onClick={() => setShareOpen(true)}
              >
                <ShareIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Rename playlist">
              <IconButton aria-label="Rename playlist" onClick={() => setRenameOpen(true)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete playlist">
              <IconButton aria-label="Delete playlist" color="error" onClick={() => setDeleteOpen(true)}>
                <TrashIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </div>

          {/* Same progress bar as CollectionPage: shown while a download
              run is in flight, counting saved tracks (catalogue + jobs). */}
          {downloadInFlight && (
            <div className="mx-auto mt-3 max-w-[420px] sm:mx-0">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={songs.length}
                aria-valuenow={downloadedJobs}
                aria-label="Playlist download progress"
                className="h-1 w-full overflow-hidden rounded-full bg-hover"
              >
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-300"
                  style={{
                    width: `${songs.length ? (downloadedJobs / songs.length) * 100 : 0}%`,
                  }}
                />
              </div>
              <span className="mt-1 block text-xs leading-[1.4] text-muted">
                Downloading {downloadedJobs}/{songs.length}
              </span>
            </div>
          )}

          {downloadInFlight && (
            <div className="mx-auto mt-3 max-w-[420px] sm:mx-0">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={songs.length}
                aria-valuenow={downloadedJobs}
                aria-label="Playlist download progress"
                className="h-1 w-full overflow-hidden rounded-full bg-hover"
              >
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-300"
                  style={{ width: `${songs.length ? (downloadedJobs / songs.length) * 100 : 0}%` }}
                />
              </div>
              <span className="mt-1 block text-xs leading-[1.4] text-muted">
                Downloading {downloadedJobs}/{songs.length}
              </span>
            </div>
          )}
        </div>
      </div>

      {songs.length === 0 ? (
        <EmptyHint
          title="This playlist is empty"
          hint="Add songs with the playlist button on any row in Songs, Home or Search."
        />
      ) : (
        <div ref={drag.containerRef}>
          {songs.map((song, index) => (
            <div
              key={song.videoId}
              {...drag.rowProps(index)}
              className="flex items-center"
            >
              {/* Drag handle — outside the SongRow, so grabbing it can never
                  trigger the row's play action. SongRow itself is untouched. */}
              <button
                type="button"
                aria-label={`Reorder ${song.title} in playlist`}
                title="Drag to reorder"
                {...drag.handleProps(index)}
                onClick={(event) => event.stopPropagation()}
                className="inline-grid shrink-0 cursor-grab place-items-center self-center rounded-full p-1 text-muted transition-colors hover:bg-hover active:cursor-grabbing max-sm:min-h-11 max-sm:min-w-11"
              >
                <GripIcon />
              </button>
              <div className="min-w-0 flex-1">
                <SongRow
                  track={song}
                  contextTracks={songs}
                  showDownloaded={song.isDownloaded}
                  showAddToPlaylist
                  onRemove={() => void handleRemove(song.videoId)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <PlaylistFormDialog
        open={renameOpen}
        mode="rename"
        initialName={playlist.name}
        initialDescription={playlist.description}
        onSubmit={handleRename}
        onClose={() => setRenameOpen(false)}
      />

      <SharePlaylistDialog
        open={shareOpen}
        playlist={playlist}
        songs={songs}
        onClose={() => setShareOpen(false)}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Delete playlist?"
        message={`“${playlist.name}” will be removed. The songs themselves stay in your library.`}
        busy={busy}
        onConfirm={() => void handleDelete()}
        onClose={() => setDeleteOpen(false)}
      />
    </section>
  );
}

/** Back affordance shared by the loading / error / loaded states. */
function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Tooltip title="Back to library">
      <IconButton aria-label="Back to library" onClick={onBack} className="mb-2">
        <ArrowBackIcon />
      </IconButton>
    </Tooltip>
  );
}
