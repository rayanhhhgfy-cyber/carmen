/**
 * Playlists page — the Library's Playlists tab: a responsive grid of
 * playlist cards plus the create / rename / delete flows. Opening a card
 * swaps the whole Library content area for the detail view (see
 * `LibraryPage`), so coming back remounts this page and its data is fresh
 * again by construction. The tab bar owns the title; the "New playlist"
 * action sits on the summary line.
 */
import { useCallback, useEffect, useState } from 'react';
import { Box, Button, IconButton, Menu, MenuItem, Skeleton, Tooltip, Typography } from '@mui/material';

import MarqueeText from '../../components/MarqueeText';
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
import { Artwork, EditIcon, MoreVertIcon, MusicNoteIcon, PlusIcon, TrashIcon } from './glyphs';

interface PlaylistsSectionProps {
  /** Called with the playlist id — the parent opens the detail view. */
  onOpen: (playlistId: number) => void;
}

interface FormTarget {
  mode: 'create' | 'rename';
  playlist: Playlist | null;
}

export default function PlaylistsSection({ onOpen }: PlaylistsSectionProps) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [covers, setCovers] = useState<Record<number, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; playlist: Playlist } | null>(null);
  const [form, setForm] = useState<FormTarget | null>(null);
  const [deleteFor, setDeleteFor] = useState<Playlist | null>(null);
  const [deleting, setDeleting] = useState(false);

  /** Playlist list + cover artwork (explicit cover video → first track). */
  const load = useCallback(async () => {
    const lists = await listPlaylists();
    setPlaylists(lists);

    const entries: [number, string | null][] = await Promise.all(
      lists.map(async (playlist): Promise<[number, string | null]> => {
        if (playlist.coverVideoId) {
          return [playlist.id, cdnArtwork(playlist.coverVideoId)];
        }
        try {
          const songs = await listPlaylistTracks(playlist.id);
          return [playlist.id, songs[0]?.artwork ?? null];
        } catch {
          return [playlist.id, null];
        }
      }),
    );
    const map: Record<number, string | null> = {};
    for (const [id, artwork] of entries) map[id] = artwork;
    setCovers(map);
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
    <Box component="section">
      <PageSummary
        action={
          <Button
            size="small"
            variant="outlined"
            startIcon={<PlusIcon />}
            onClick={() => setForm({ mode: 'create', playlist: null })}
          >
            New playlist
          </Button>
        }
      >
        {loading
          ? 'Loading…'
          : `${playlists.length} playlist${playlists.length === 1 ? '' : 's'}`}
      </PageSummary>

      {loading && playlists.length === 0 ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 2 }}>
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} variant="rounded" height={196} />
          ))}
        </Box>
      ) : empty ? (
        <EmptyHint
          title="No playlists yet"
          hint="Create one to group songs from your downloads, favorites or the web."
        />
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: 2,
          }}
        >
          {playlists.map((playlist) => (
            <Box key={playlist.id} sx={{ position: 'relative' }}>
              <Box
                component="button"
                type="button"
                onClick={() => onOpen(playlist.id)}
                sx={{
                  width: '100%',
                  // No automatic minimum: a long playlist name clips +
                  // scrolls inside the cell instead of inflating the card.
                  minWidth: 0,
                  p: 0,
                  m: 0,
                  border: 0,
                  background: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                  '&:hover .playlist-art': { transform: 'scale(1.03)' },
                }}
              >
                <Artwork
                  className="playlist-art"
                  src={covers[playlist.id] ?? null}
                  alt=""
                  icon={MusicNoteIcon}
                  iconSize={44}
                  sx={{
                    width: '100%',
                    aspectRatio: '1 / 1',
                    borderRadius: 2,
                    boxShadow: 1,
                    transition: 'transform 220ms ease',
                  }}
                />
                <Box sx={{ minWidth: 0 }}>
                  <MarqueeText text={playlist.name} variant="body2" sx={{ fontWeight: 600 }} />
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {playlist.trackCount} song{playlist.trackCount === 1 ? '' : 's'}
                  </Typography>
                </Box>
              </Box>

              <Tooltip title="Playlist actions" placement="top">
                <IconButton
                  size="small"
                  aria-label={`Actions for ${playlist.name}`}
                  onClick={(event) => setMenu({ anchor: event.currentTarget, playlist })}
                  sx={{
                    position: 'absolute',
                    top: 6,
                    right: 6,
                    width: 30,
                    height: 30,
                    bgcolor: 'rgba(0, 0, 0, 0.45)',
                    color: '#fff',
                    '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.65)' },
                  }}
                >
                  <MoreVertIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            </Box>
          ))}
        </Box>
      )}

      <Menu
        anchorEl={menu?.anchor}
        open={Boolean(menu)}
        onClose={() => setMenu(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          onClick={() => {
            if (menu) setForm({ mode: 'rename', playlist: menu.playlist });
            setMenu(null);
          }}
        >
          <EditIcon fontSize="small" sx={{ mr: 1.5 }} />
          Rename
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menu) setDeleteFor(menu.playlist);
            setMenu(null);
          }}
        >
          <TrashIcon fontSize="small" sx={{ mr: 1.5 }} />
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
    </Box>
  );
}
