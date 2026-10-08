/**
 * Playlist detail — the in-page view the Library swaps to when a playlist
 * card is opened (no route change: `LibraryPage` holds the selection).
 *
 * Shows the cover, rename/delete controls, Play All / Shuffle All and the
 * ordered track rows with a per-track remove action.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  IconButton,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';

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
      <Box component="section">
        <Skeleton variant="text" width={120} height={32} />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} sx={{ mt: 1 }}>
          <Skeleton variant="rounded" width={180} height={180} />
          <Box sx={{ flex: 1 }}>
            <Skeleton variant="text" width="55%" height={40} />
            <Skeleton variant="text" width="35%" />
            <Skeleton variant="text" width="70%" />
          </Box>
        </Stack>
      </Box>
    );
  }

  if (!playlist) {
    return (
      <Box component="section">
        <BackButton onBack={onBack} />
        <EmptyHint title="Playlist not found" hint="It may have been deleted." />
      </Box>
    );
  }

  return (
    <Box component="section">
      <BackButton onBack={onBack} />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} sx={{ mb: 2.5 }}>
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

        <Box sx={{ flex: 1, minWidth: 0, textAlign: { xs: 'center', sm: 'left' } }}>
          <Typography variant="overline" color="text.secondary">
            Playlist
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            {playlist.name}
          </Typography>
          {playlist.description && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                mt: 0.5,
                whiteSpace: 'pre-line',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {playlist.description}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
            {songs.length} track{songs.length === 1 ? '' : 's'}
          </Typography>

          <Stack
            direction="row"
            spacing={1}
            sx={{ mt: 2, justifyContent: { xs: 'center', sm: 'flex-start' }, flexWrap: 'wrap', rowGap: 1 }}
          >
            <Button
              variant="contained"
              startIcon={<PlayArrowIcon />}
              disabled={!songs.length}
              onClick={playAll}
            >
              Play all
            </Button>
            <Button
              variant="outlined"
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
          </Stack>
        </Box>
      </Stack>

      {songs.length === 0 ? (
        <EmptyHint
          title="This playlist is empty"
          hint="Add songs with the playlist button on any row in Songs, Home or Search."
        />
      ) : (
        <Box>
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
        </Box>
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
    </Box>
  );
}

/** Back affordance shared by the loading / error / loaded states. */
function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Tooltip title="Back to library">
      <IconButton aria-label="Back to library" onClick={onBack} sx={{ mb: 1 }}>
        <ArrowBackIcon />
      </IconButton>
    </Tooltip>
  );
}
