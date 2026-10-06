import { useEffect, useState } from 'react';
import {
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Tooltip,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useDownloads } from '../hooks';
import { usePlayer } from '../player/PlayerContext';
import { downloadLyrics, startDownload } from '../utils/downloads';
import {
  AlbumIcon,
  DownloadIcon,
  LyricsIcon,
  MoreVertIcon,
  UserIcon,
} from './icons';

/**
 * The player's "⋯" menu: everything about the song that is not a transport
 * control — download it, jump to its artist, jump to its album, save its
 * lyrics.
 *
 * It replaced two standalone buttons (info + download): the menu keeps them
 * out of the thumb's way while still being one tap away, and it has room for
 * the jumps that have nowhere to go as a button.
 *
 * Downloading the song that is currently streaming first waits for the
 * player's stream to finish writing the server side audio cache, so the job
 * reads that finished file instead of opening a second stream.
 */
export default function PlayerMenu({ track, meta }) {
  const [anchor, setAnchor] = useState(null);
  const { jobs } = useDownloads();
  const player = usePlayer();
  const navigate = useNavigate();

  // a new song: the old anchor node is gone with the old row
  useEffect(() => {
    setAnchor(null);
  }, [track?.videoId]);

  if (!track?.videoId) return null;

  const job = jobs[track.videoId];
  const running = job?.status === 'running';
  const saved = job?.status === 'done';
  const label = running
    ? job.step || 'Downloading'
    : saved
      ? 'Saved to your device'
      : 'Download';

  const artist =
    track.artist && track.artist !== 'Unknown artist'
      ? track.artist
      : track.artists?.[0]?.name || '';
  const albumName = meta?.album?.name || track.album?.name || track.albumName || '';
  const albumId = meta?.album?.id || track.album?.id || null;
  const hasLyrics = Boolean(meta?.lyrics?.synced?.length || meta?.lyrics?.unsynced);

  const close = () => setAnchor(null);

  /** Leave the player first: the destination page *is* the new context. */
  const go = (to) => {
    close();
    player.setSheetOpen(false);
    navigate(to);
  };

  const onDownload = () => {
    close();
    const playingHere = player.current?.videoId === track.videoId;
    startDownload(track, meta, {
      // resolves as soon as the server has the file (or waiting stopped
      // making sense); safe to skip when the song is not streaming
      waitForCache: playingHere ? () => player.waitForCache(track.videoId) : null,
    });
  };

  return (
    <>
      <Tooltip title="More">
        <IconButton
          size="small"
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={anchor ? true : undefined}
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={{ width: 34, height: 34, border: 1, borderColor: 'divider' }}
        >
          <MoreVertIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={close}
        transformOrigin={{ horizontal: 'center', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'center', vertical: 'bottom' }}
      >
        <MenuItem disabled={running || saved} onClick={onDownload}>
          <ListItemIcon>
            <DownloadIcon fontSize="small" />
          </ListItemIcon>
          {label}
        </MenuItem>
        <MenuItem
          disabled={!artist}
          onClick={() => go(`/search?query=${encodeURIComponent(artist)}`)}
        >
          <ListItemIcon>
            <UserIcon fontSize="small" />
          </ListItemIcon>
          Go to artist
        </MenuItem>
        <MenuItem
          disabled={!albumId && !albumName}
          onClick={() =>
            go(
              albumId
                ? `/collection/album/${encodeURIComponent(albumId)}`
                : `/search?query=${encodeURIComponent(albumName)}`,
            )
          }
        >
          <ListItemIcon>
            <AlbumIcon fontSize="small" />
          </ListItemIcon>
          Go to album
        </MenuItem>
        <MenuItem
          disabled={!hasLyrics}
          onClick={() => {
            close();
            downloadLyrics(track, meta);
          }}
        >
          <ListItemIcon>
            <LyricsIcon fontSize="small" />
          </ListItemIcon>
          Download Lyrics
        </MenuItem>
      </Menu>
    </>
  );
}
