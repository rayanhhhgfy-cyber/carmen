/**
 * Playlist detail — the in-page view the Library swaps to when a playlist
 * card is opened (no route change: `LibraryPage` holds the selection).
 *
 * Shows the cover, rename/delete controls, Play All / Shuffle All and the
 * ordered track rows with a per-track remove action.
 */
import { useCallback, useEffect, useState } from 'react';

import { Button, IconButton, Shimmer, Tooltip } from '../../components/ui';
import {
  deletePlaylist,
  getPlaylist,
  listPlaylistTracks,
  removeTrackFromPlaylist,
  renamePlaylist,
} from '../../db/repos/playlists';
import { usePlayer } from '../../player/PlayerContext';
import type { Playlist, PlaylistSong } from '../../types/models';
import { shuffleList } from '../../utils/library';
import { cdnArtwork } from '../../utils/track';
import { ConfirmDialog, EmptyHint, PlaylistFormDialog } from './common';
import {
  ArrowBackIcon,
  Artwork,
  EditIcon,
  MusicNoteIcon,
  PlayArrowIcon,
  ShuffleIcon,
  TrashIcon,
} from './glyphs';
import SongRow from './SongRow';

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
  const [busy, setBusy] = useState(false);

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
          sx={{
            width: { xs: 160, sm: 180 },
            height: { xs: 160, sm: 180 },
            borderRadius: 3,
            boxShadow: 3,
            mx: { xs: 'auto', sm: 0 },
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
        </div>
      </div>

      {songs.length === 0 ? (
        <EmptyHint
          title="This playlist is empty"
          hint="Add songs with the playlist button on any row in Songs, Home or Search."
        />
      ) : (
        <div>
          {songs.map((song) => (
            <SongRow
              key={song.videoId}
              track={song}
              contextTracks={songs}
              showDownloaded={song.isDownloaded}
              showAddToPlaylist
              onRemove={() => void handleRemove(song.videoId)}
            />
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
