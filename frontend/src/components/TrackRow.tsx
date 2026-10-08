import { useState } from 'react';
import {
  Box,
  Collapse,
  Divider,
  IconButton,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';
import { useFlag } from '../db/flags';
import { usePlayer } from '../player/PlayerContext';
import { useTheme } from '../theme/ThemeContext';
import type { Track, TrackMeta } from '../types/models';
import { formatTime } from '../utils/format';
import Artwork from './Artwork';
import DownloadButton from './DownloadButton';
import {
  DownloadIcon,
  ExplicitIcon,
  HeartFilledIcon,
  InfoIcon,
  MoreVertIcon,
  MusicNoteIcon,
  PlayArrowIcon,
  PlusIcon,
  QueueMusicIcon,
} from './icons';

/** Props for one row of the track list. */
export interface TrackRowProps {
  track: Track;
  /** Ordered list this track belongs to — the context it plays inside. */
  contextTracks?: Track[] | null;
  /** 1-based position shown instead of the cover art (`null` hides it). */
  index?: number | null;
  meta?: TrackMeta | null;
}

function Equalizer() {
  // The bars are accent-coloured line art — read the readable accent here so
  // a white high-performance accent stays visible on a light row.
  const { accentFg } = useTheme();
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.4, height: 16 }} aria-hidden>
      {[0.4, 1, 0.65].map((scale, position) => (
        <Box
          key={position}
          sx={{
            width: 3,
            borderRadius: 2,
            bgcolor: accentFg,
            height: 16,
            transformOrigin: 'bottom',
            animation: `eq-bar 900ms ${position * 140}ms ease-in-out infinite alternate`,
            '@keyframes eq-bar': {
              from: { transform: `scaleY(${scale * 0.35})` },
              to: { transform: `scaleY(${scale})` },
            },
          }}
        />
      ))}
    </Box>
  );
}

/**
 * One row of the track list. Tapping the row plays the track inside the
 * given context; the ⋯ menu offers queue actions, a collapsible details view
 * and the browser side MP3 download.
 */
export default function TrackRow({
  track,
  contextTracks = null,
  index = null,
  meta = null,
}: TrackRowProps) {
  const player = usePlayer();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Read the flags per row (not per list) so each badge flips live the moment
  // a download finishes or a heart is toggled anywhere in the app.
  const downloaded = useFlag('downloaded', track.videoId);
  const favorite = useFlag('favorite', track.videoId);

  const active = player.current?.videoId === track.videoId;
  // Accent used for text/lines painted on the row surface (active title,
  // index, EQ bars) — never the raw white accent, which would disappear on
  // a light background (see `accentFg` in ThemeContext).
  const { accentFg } = useTheme();
  const artwork = track.artwork;

  return (
    <>
      <ListItem
        disablePadding
        secondaryAction={
          <Box sx={{ display: 'flex', alignItems: 'center', pr: 0.5 }}>
            {active && player.isPlaying ? <Equalizer /> : (
              <Typography variant="caption" color="text.secondary" sx={{ mr: 1, minWidth: 34, textAlign: 'right' }}>
                {track.duration ? formatTime(track.duration) : ''}
              </Typography>
            )}
            <IconButton
              size="small"
              aria-label={`Actions for ${track.title}`}
              onClick={(event) => setAnchor(event.currentTarget)}
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>
          </Box>
        }
      >
        <ListItemButton
          onClick={() => player.playTrack(track, contextTracks)}
          sx={{
            borderRadius: 2,
            py: 0.75,
            bgcolor: active ? 'action.selected' : 'transparent',
            '&:hover': { bgcolor: active ? 'action.hover' : 'action.hover' },
          }}
        >
          {artwork ? (
            <ListItemIcon sx={{ minWidth: 46 }}>
              <Artwork
                src={artwork}
                alt=""
                icon={MusicNoteIcon}
                iconSize={22}
                sx={{ width: 44, height: 44, borderRadius: 1.5 }}
              />
            </ListItemIcon>
          ) : index !== null ? (
            <Typography
              variant="body2"
              color={active ? accentFg : 'text.secondary'}
              sx={{ width: 46, textAlign: 'center', fontWeight: 600 }}
            >
              {index + 1}
            </Typography>
          ) : (
            <ListItemIcon sx={{ minWidth: 46 }}>
              <Artwork
                src={null}
                icon={MusicNoteIcon}
                iconSize={22}
                sx={{ width: 44, height: 44, borderRadius: 1.5 }}
              />
            </ListItemIcon>
          )}
          <ListItemText
            primary={
              <Typography
                variant="body2"
                noWrap
                sx={{ fontWeight: active ? 700 : 500, color: active ? accentFg : 'text.primary' }}
              >
                {track.title}
              </Typography>
            }
            secondary={
              <Typography variant="caption" noWrap sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {track.isExplicit && <ExplicitIcon sx={{ fontSize: 13 }} />}
                {/* Passive badges on the meta line — the trailing slot keeps the ⋯ menu / duration only.
                    `titleAccess` marks them meaningful for screen readers (SvgIcon is aria-hidden otherwise). */}
                {downloaded && (
                  <DownloadIcon
                    titleAccess="Downloaded"
                    sx={{ fontSize: 14, color: 'text.secondary', flexShrink: 0 }}
                  />
                )}
                {favorite && (
                  <HeartFilledIcon
                    titleAccess="Favorite"
                    sx={{ fontSize: 14, color: 'text.secondary', flexShrink: 0 }}
                  />
                )}
                {track.artist}
              </Typography>
            }
          />
        </ListItemButton>
      </ListItem>

      <Collapse in={detailsOpen} timeout="auto" unmountOnExit>
        <Box sx={{ px: 2, pb: 1.5, pl: 9 }}>
          <Divider sx={{ mb: 1 }} />
          <Typography variant="caption" color="text.secondary">
            {[
              track.albumName,
              track.duration ? formatTime(track.duration) : null,
              track.isExplicit ? 'Explicit' : null,
            ]
              .filter(Boolean)
              .join('  •  ')}
          </Typography>
        </Box>
      </Collapse>

      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          onClick={() => {
            player.playTrack(track, contextTracks);
            setAnchor(null);
          }}
        >
          <ListItemIcon><PlayArrowIcon fontSize="small" /></ListItemIcon>
          Play
        </MenuItem>
        <MenuItem
          onClick={() => {
            player.playNext(track);
            setAnchor(null);
          }}
        >
          <ListItemIcon><PlusIcon fontSize="small" /></ListItemIcon>
          Play next
        </MenuItem>
        <MenuItem
          onClick={() => {
            player.addToQueue(track);
            setAnchor(null);
          }}
        >
          <ListItemIcon><QueueMusicIcon fontSize="small" /></ListItemIcon>
          Add to queue
        </MenuItem>
        <MenuItem
          onClick={() => {
            setDetailsOpen((value) => !value);
            setAnchor(null);
          }}
        >
          <ListItemIcon><InfoIcon fontSize="small" /></ListItemIcon>
          {detailsOpen ? 'Hide details' : 'Show details'}
        </MenuItem>
        <MenuItem>
          <DownloadButton track={track} meta={meta} size="small" />
          <Typography variant="body2">Download MP3</Typography>
        </MenuItem>
      </Menu>
    </>
  );
}
