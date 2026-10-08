/**
 * One song row of the Library lists (downloaded songs, playlist tracks).
 *
 * Self-contained on purpose: the heart, the "add to playlist" picker and the
 * row menu live here, so both lists stay a one-liner per track. Tapping the
 * row body plays the track inside its list's context; every other control is
 * a sibling of the play button (never nested inside it).
 */
import { useEffect, useState } from 'react';
import { Box, IconButton, Menu, MenuItem, Stack, Tooltip, Typography } from '@mui/material';

import { toggleFavorite } from '../../db/repos/favorites';
import { usePlayer } from '../../player/PlayerContext';
import type { Track } from '../../types/models';
import { formatTime } from '../../utils/format';
import AddToPlaylistDialog from './AddToPlaylistDialog';
import {
  Artwork,
  CheckCircleIcon,
  ExplicitIcon,
  HeartFilledIcon,
  HeartIcon,
  MoreVertIcon,
  MusicNoteIcon,
  PlaylistAddIcon,
  PlayArrowIcon,
  QueueMusicIcon,
  TrashIcon,
} from './glyphs';

/** A track plus the optional flags the downloaded / playlist rows carry. */
export type LibrarySong = Track & {
  isFavorite?: boolean;
  isDownloaded?: boolean;
};

export interface SongRowProps {
  track: LibrarySong;
  /** Everything reachable from this row — becomes the playback queue. */
  contextTracks?: Track[] | null;
  /** Filled check mark: the audio is on disk. */
  showDownloaded?: boolean;
  /** Shows the "add to playlist" button. */
  showAddToPlaylist?: boolean;
  /** Enables the row menu with "Remove from this playlist". */
  onRemove?: () => void;
  /** Fires after a heart toggle — the list may need to refilter itself. */
  onFavoriteChange?: (videoId: string, next: boolean) => void;
}

/** Bars shown while this row is the one actually playing. */
function Equalizer() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.4, height: 14, pr: 1 }} aria-hidden>
      {[0.4, 1, 0.65].map((scale, position) => (
        <Box
          key={position}
          sx={{
            width: 3,
            borderRadius: 2,
            bgcolor: 'primary.main',
            height: 14,
            transformOrigin: 'bottom',
            animation: `row-eq 900ms ${position * 140}ms ease-in-out infinite alternate`,
            '@keyframes row-eq': {
              from: { transform: `scaleY(${scale * 0.35})` },
              to: { transform: `scaleY(${scale})` },
            },
          }}
        />
      ))}
    </Box>
  );
}

export default function SongRow({
  track,
  contextTracks = null,
  showDownloaded = false,
  showAddToPlaylist = false,
  onRemove,
  onFavoriteChange,
}: SongRowProps) {
  const player = usePlayer();
  const [favorite, setFavorite] = useState(track.isFavorite ?? false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [addingToPlaylist, setAddingToPlaylist] = useState(false);

  const active = player.current?.videoId === track.videoId;
  const playing = active && player.isPlaying;

  // Keep the heart in sync when the parent reloads with fresh rows.
  useEffect(() => {
    setFavorite(track.isFavorite ?? false);
  }, [track.isFavorite]);

  const handleFavorite = async () => {
    const next = await toggleFavorite(track);
    setFavorite(next);
    onFavoriteChange?.(track.videoId, next);
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        pr: 1,
        borderRadius: 2,
        bgcolor: active ? 'action.selected' : 'transparent',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Box
        component="button"
        type="button"
        onClick={() => player.playTrack(track, contextTracks)}
        sx={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          px: 1,
          py: 0.75,
          border: 0,
          background: 'none',
          color: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
          borderRadius: 2,
        }}
      >
        <Artwork
          src={track.artwork}
          alt=""
          icon={MusicNoteIcon}
          iconSize={20}
          sx={{ width: 42, height: 42, borderRadius: 1.5, flexShrink: 0 }}
        />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            variant="body2"
            noWrap
            sx={{
              fontWeight: active ? 700 : 500,
              color: active ? 'primary.main' : 'text.primary',
            }}
          >
            {track.title}
          </Typography>
          <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minWidth: 0 }}>
            {track.isExplicit && (
              <ExplicitIcon sx={{ fontSize: 13, color: 'text.secondary', flexShrink: 0 }} />
            )}
            <Typography variant="caption" noWrap sx={{ color: 'text.secondary' }}>
              {track.albumName ? `${track.artist}  •  ${track.albumName}` : track.artist}
            </Typography>
          </Stack>
        </Box>
      </Box>

      <Stack direction="row" alignItems="center" spacing={0.25} sx={{ flexShrink: 0 }}>
        {playing ? (
          <Equalizer />
        ) : (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ minWidth: 34, textAlign: 'right', display: { xs: 'none', sm: 'block' } }}
          >
            {track.duration ? formatTime(track.duration) : ''}
          </Typography>
        )}

        {showDownloaded && (
          <Tooltip title="Downloaded" placement="top">
            <CheckCircleIcon color="success" sx={{ fontSize: 18, display: { xs: 'none', sm: 'flex' } }} />
          </Tooltip>
        )}

        <Tooltip title={favorite ? 'Remove from favorites' : 'Add to favorites'} placement="top">
          <IconButton
            size="small"
            aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
            color={favorite ? 'primary' : 'default'}
            onClick={() => void handleFavorite()}
          >
            {favorite ? <HeartFilledIcon fontSize="small" /> : <HeartIcon fontSize="small" />}
          </IconButton>
        </Tooltip>

        {showAddToPlaylist && (
          <Tooltip title="Add to playlist" placement="top">
            <IconButton
              size="small"
              aria-label="Add to playlist"
              onClick={() => setAddingToPlaylist(true)}
            >
              <PlaylistAddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}

        {onRemove && (
          <IconButton
            size="small"
            aria-label={`Actions for ${track.title}`}
            onClick={(event) => setMenuAnchor(event.currentTarget)}
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
        )}
      </Stack>

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          onClick={() => {
            player.playTrack(track, contextTracks);
            setMenuAnchor(null);
          }}
        >
          <PlayArrowIcon fontSize="small" sx={{ mr: 1.5 }} />
          Play
        </MenuItem>
        <MenuItem
          onClick={() => {
            player.playNext(track);
            setMenuAnchor(null);
          }}
        >
          <QueueMusicIcon fontSize="small" sx={{ mr: 1.5 }} />
          Play next
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            onRemove?.();
          }}
        >
          <TrashIcon fontSize="small" sx={{ mr: 1.5 }} />
          Remove from this playlist
        </MenuItem>
      </Menu>

      <AddToPlaylistDialog
        open={addingToPlaylist}
        track={track}
        onClose={() => setAddingToPlaylist(false)}
      />
    </Box>
  );
}
