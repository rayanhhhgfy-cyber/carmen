import { useEffect, useState } from 'react';
import { IconButton, Tooltip } from '../components/ui';
import { ListItemIcon, Menu, MenuItem } from '../components/ui/Overlay';
import { useNavigate } from 'react-router-dom';
import { useDownloads } from '../hooks';
import AddToPlaylistDialog from '../pages/library/AddToPlaylistDialog';
import { usePlayer, useSleepTimer } from '../player/PlayerContext';
import type { Track, TrackMeta } from '../types/models';
import { notify } from '../utils/downloadsStore';
import { shareTrack } from '../utils/share';
import {
  formatSleepRemaining,
  SLEEP_TIMER_MINUTE_OPTIONS,
} from '../utils/sleepTimer';
import {
  AlbumIcon,
  DownloadIcon,
  LyricsIcon,
  MoreVertIcon,
  PlaylistAddIcon,
  ShareIcon,
  UserIcon,
} from './icons';

/** Props for the player's overflow menu. */
export interface PlayerMenuProps {
  track: Track | null;
  meta: TrackMeta | null;
}

/**
 * The player's "⋯" menu: everything about the song that is not a transport
 * control — download it, share it, add it to a playlist, jump to its
 * artist, jump to its album, save its lyrics.
 *
 * It replaced two standalone buttons (info + download): the menu keeps them
 * out of the thumb's way while still being one tap away, and it has room for
 * the jumps that have nowhere to go as a button.
 *
 * Downloading the song that is currently streaming first waits for the
 * player's stream to finish writing the server side audio cache, so the job
 * reads that finished file instead of opening a second stream.
 */
export default function PlayerMenu({ track, meta }: PlayerMenuProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [addingToPlaylist, setAddingToPlaylist] = useState(false);
  const { jobs } = useDownloads();
  const player = usePlayer();
  const sleep = useSleepTimer();
  const navigate = useNavigate();

  // a new song: the old anchor node is gone with the old row, and a picker
  // left open for the previous song must not add the wrong track
  useEffect(() => {
    setAnchor(null);
    setAddingToPlaylist(false);
  }, [track?.videoId]);

  if (!track?.videoId) return null;

  const job = jobs[track.videoId];
  const running = job?.status === 'running';
  const saved = job?.status === 'done';
  const label = running
    ? job?.step || 'Downloading'
    : saved
      ? 'Saved to your device'
      : 'Download';

  // The API is inconsistent: `artists[0]` may be a plain string instead of
  // `{ name }`, and `meta.album` may be a plain string instead of an object.
  const firstArtist = track.artists?.[0];
  const artist =
    track.artist && track.artist !== 'Unknown artist'
      ? track.artist
      : typeof firstArtist === 'object' && firstArtist
        ? firstArtist.name
        : '';
  const metaAlbum = typeof meta?.album === 'object' && meta.album ? meta.album : null;
  const albumName = metaAlbum?.name || track.album?.name || track.albumName || '';
  const albumId = metaAlbum?.id || track.album?.id || null;
  const hasLyrics = Boolean(meta?.lyrics?.synced?.length || meta?.lyrics?.unsynced);

  const close = () => setAnchor(null);

  // Remaining time, shown beside the ⋯ trigger (in the player sheet's
  // header row, where this menu lives) and inside the menu itself via
  // the selected option below. The mini player is deliberately untouched:
  // it does not render this menu, so the countdown lives on the sheet,
  // not the docked bar. Fading shows its own label — the countdown is
  // over and the ~10 s fade is what remains.
  const sleepLabel =
    sleep.timer.status === 'fading'
      ? 'Fading out…'
      : sleep.timer.option === 'end-of-track'
        ? 'End of track'
        : sleep.remainingMs !== null
          ? formatSleepRemaining(sleep.remainingMs)
          : null;

  /** Leave the player first: the destination page *is* the new context. */
  const go = (to: string) => {
    close();
    player.setSheetOpen(false);
    navigate(to);
  };

  const onDownload = () => {
    close();
    const playingHere = player.current?.videoId === track.videoId;
    // Lazy-load the pipeline on first use — shared with the row Download
    // button, so it only ever loads into memory once per session.
    void import('../utils/downloads')
      .then((m) =>
        m.startDownload(track, meta, {
          // resolves as soon as the server has the file (or waiting stopped
          // making sense); safe to skip when the song is not streaming
          waitForCache: playingHere ? () => player.waitForCache(track.videoId) : undefined,
        }),
      )
      .catch(() => notify('error', 'Could not start the download — try again'));
  };

  return (
    <>
      <div className="flex shrink-0 items-center gap-2">
        {/* `placement="bottom"` keeps MUI's default tooltip direction. */}
        <Tooltip title="More" placement="bottom">
          <IconButton
            size="small"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={anchor ? true : undefined}
            onClick={(event) => setAnchor(event.currentTarget)}
            className="size-11 shrink-0 border border-line"
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {/* Live countdown pill: tapping it opens this same menu, where the
            timer can be changed or cancelled. Hidden when no timer runs. */}
        {sleepLabel !== null && (
          <button
            type="button"
            aria-label={`Sleep timer ${sleepLabel} — open menu to change or cancel`}
            aria-haspopup="menu"
            aria-expanded={anchor ? true : undefined}
            onClick={(event) => setAnchor(event.currentTarget)}
            className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-line px-2.5 py-1.5 text-xs font-semibold text-body"
          >
            {sleepLabel}
          </button>
        )}
      </div>

      {/* MIGRATION: `anchorOrigin` / `transformOrigin` dropped — the kit Menu
          anchors itself 4px below the trigger (and flips above when it would
          overflow), so it self-positions instead of taking origin props. */}
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={close}
      >
        <MenuItem disabled={running || saved} onClick={onDownload}>
          <ListItemIcon>
            <DownloadIcon fontSize="small" />
          </ListItemIcon>
          {label}
        </MenuItem>
        <MenuItem
          onClick={() => {
            close();
            void shareTrack(track);
          }}
        >
          <ListItemIcon>
            <ShareIcon fontSize="small" />
          </ListItemIcon>
          Share
        </MenuItem>
        <MenuItem
          onClick={() => {
            close();
            setAddingToPlaylist(true);
          }}
        >
          <ListItemIcon>
            <PlaylistAddIcon fontSize="small" />
          </ListItemIcon>
          Add to playlist
        </MenuItem>
        {/* Sleep timer: a real countdown, not a stub. Picking an option
            starts (or replaces) the timer — changing mid-countdown resets
            it from now, and Off cancels it and restores the volume if a
            fade was already running. The selected option is highlighted;
            a running minute timer also shows its remaining time here.
            End of track fires at the current track's natural end (see
            `utils/sleepTimer.ts`); minute timers keep running across
            track changes. The timer is session-scoped: it does not
            survive a page reload. */}
        <div className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-[0.16em] text-muted">
          Sleep timer
        </div>
        <MenuItem
          selected={sleep.timer.option === 'off'}
          onClick={() => sleep.setSleepTimer('off')}
        >
          Off
        </MenuItem>
        <MenuItem
          selected={sleep.timer.option === 'end-of-track'}
          onClick={() => sleep.setSleepTimer('end-of-track')}
        >
          End of track
        </MenuItem>
        {SLEEP_TIMER_MINUTE_OPTIONS.map((minutes) => (
          <MenuItem
            key={minutes}
            selected={sleep.timer.option === minutes}
            onClick={() => sleep.setSleepTimer(minutes)}
          >
            {minutes} minutes
            {sleep.timer.option === minutes && sleep.remainingMs !== null
              ? ` — ${formatSleepRemaining(sleep.remainingMs)} left`
              : ''}
          </MenuItem>
        ))}
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
            void import('../utils/downloads')
              .then((m) => m.downloadLyrics(track, meta))
              .catch(() => notify('error', 'Could not save the lyrics — try again'));
          }}
        >
          <ListItemIcon>
            <LyricsIcon fontSize="small" />
          </ListItemIcon>
          Download Lyrics
        </MenuItem>
      </Menu>

      {/* The same picker the library song rows open (SongRow pattern:
          direct import, local open state, `{ open, track, onClose }`).
          It renders through the kit Dialog in Overlay.tsx, so it pushes
          its own layer above the player sheet's layer — Escape/backdrop
          close the picker alone and the sheet stays open underneath. */}
      <AddToPlaylistDialog
        open={addingToPlaylist}
        track={track}
        onClose={() => setAddingToPlaylist(false)}
      />
    </>
  );
}
