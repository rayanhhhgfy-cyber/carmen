/**
 * "Add to playlist" picker — lists the user's playlists, appends the song to
 * the chosen one, and can create a playlist inline (create → add → close).
 */
import { useEffect, useState } from 'react';

import { Button, IconButton, List, ListItem, ListItemButton, ListItemText, ListSubheader, Spinner } from '../../components/ui';
import { Dialog, DialogActions, DialogContent, DialogTitle } from '../../components/ui/Overlay';
import { TextField } from '../../components/ui/Field';

import { addTrackToPlaylist, createPlaylist, listPlaylists } from '../../db/repos/playlists';
import type { Playlist, Track } from '../../types/models';
import { EmptyHint } from './common';
import { CloseIcon, PlusIcon } from './glyphs';

interface AddToPlaylistDialogProps {
  open: boolean;
  track: Track;
  onClose: () => void;
}

export default function AddToPlaylistDialog({ open, track, onClose }: AddToPlaylistDialogProps) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reload the list on every open so a playlist created elsewhere shows up.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setCreating(false);
    setName('');
    setError(null);
    setLoading(true);
    listPlaylists()
      .then((rows) => {
        if (!cancelled) setPlaylists(rows);
      })
      .catch((listError) => console.warn('[library] load playlists failed', listError))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const pick = async (playlistId: number) => {
    if (busy) return;
    setBusy(true);
    try {
      await addTrackToPlaylist(playlistId, track);
      onClose();
    } catch (addError) {
      console.warn('[library] add to playlist failed', addError);
      setError('Could not add the song — please try again.');
      setBusy(false);
    }
  };

  const createAndAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const playlistId = await createPlaylist(trimmed);
      await addTrackToPlaylist(playlistId, track);
      onClose();
    } catch (addError) {
      console.warn('[library] create playlist failed', addError);
      setError('Could not create the playlist — please try again.');
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        Add to playlist
        <span className="block truncate text-xs font-normal leading-[1.4] text-muted">
          {track.title} · {track.artist}
        </span>
        <IconButton
          aria-label="Close"
          onClick={onClose}
          disabled={busy}
          className="!absolute right-2 top-2"
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent>
        {creating ? (
          <TextField
            autoFocus
            fullWidth
            label="Playlist name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
            error={Boolean(error)}
            helperText={error ?? ' '}
            margin="dense"
            // MIGRATION: the kit TextField takes no top-level `onKeyDown` —
            // the handler moves onto the control through `inputProps`.
            inputProps={{
              onKeyDown: (event) => {
                if (event.key === 'Enter') void createAndAdd();
              },
            }}
          />
        ) : loading ? (
          <div className="grid place-items-center py-8">
            <Spinner size={26} />
          </div>
        ) : (
          <List dense disablePadding>
            <ListSubheader className="bg-transparent px-0">Your playlists</ListSubheader>
            {playlists.length === 0 && (
              <EmptyHint dense title="No playlists yet" hint="create one below" />
            )}
            {playlists.map((playlist) => (
              <ListItem key={playlist.id} disablePadding>
                <ListItemButton onClick={() => void pick(playlist.id)} disabled={busy}>
                  <ListItemText
                    primary={playlist.name}
                    secondary={`${playlist.trackCount} song${playlist.trackCount === 1 ? '' : 's'}`}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>

      <DialogActions className="!justify-between">
        {creating ? (
          <>
            <Button
              onClick={() => {
                setCreating(false);
                setError(null);
              }}
              disabled={busy}
            >
              Back
            </Button>
            <Button
              variant="contained"
              startIcon={<PlusIcon />}
              onClick={() => void createAndAdd()}
              disabled={!name.trim() || busy}
            >
              {busy ? 'Working…' : 'Create & add'}
            </Button>
          </>
        ) : (
          <>
            <Button startIcon={<PlusIcon />} onClick={() => setCreating(true)} disabled={loading}>
              New playlist
            </Button>
            <Button onClick={onClose} disabled={busy}>
              Close
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
