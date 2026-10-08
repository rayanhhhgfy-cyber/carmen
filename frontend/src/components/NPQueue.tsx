import {
  Box,
  Button,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';

import { usePlayer } from '../player/PlayerContext';
import { useTheme } from '../theme/ThemeContext';
import type { Track } from '../types/models';
import { formatTime } from '../utils/format';
import { useFlag } from '../db/flags';
import Artwork from './Artwork';
import MarqueeText from './MarqueeText';
import { CloseIcon, DownloadIcon, ExplicitIcon, HeartFilledIcon, ShuffleIcon, TrashIcon } from './icons';

/** One upcoming row: tap to jump here, ✕ to drop it from the queue. */
function QueueRow({
  track,
  index,
  context,
}: {
  track: Track;
  index: number;
  context: Track[];
}) {
  const player = usePlayer();
  // Per-row subscription: badges flip live as downloads / hearts change.
  const downloaded = useFlag('downloaded', track.videoId);
  const favorite = useFlag('favorite', track.videoId);

  return (
    <ListItem
      disablePadding
      sx={{ mb: 0.5 }}
      secondaryAction={
        <Box sx={{ display: 'flex', alignItems: 'center', pr: 0.5 }}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ mr: 1, minWidth: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
          >
            {track.duration ? formatTime(track.duration) : ''}
          </Typography>
          <IconButton
            size="small"
            aria-label={`Remove ${track.title} from queue`}
            onClick={() => player.removeFromQueue(index)}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      }
    >
      <ListItemButton
        onClick={() => player.playTrack(track, context)}
        sx={{ borderRadius: 2, pr: 9 }}
      >
        <ListItemIcon sx={{ minWidth: 52 }}>
          <Artwork
            src={track.artwork}
            alt=""
            iconSize={20}
            sx={{ width: 46, height: 46, borderRadius: 1.5 }}
          />
        </ListItemIcon>
        <ListItemText
          primary={
            <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
              {track.title}
            </Typography>
          }
          secondary={
            <Typography variant="caption" noWrap sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              {track.isExplicit && <ExplicitIcon sx={{ fontSize: 13 }} />}
              {/* Passive state badges, kept muted so the meta line stays quiet. */}
              {downloaded && (
                <DownloadIcon titleAccess="Downloaded" sx={{ fontSize: 14, color: 'text.secondary', flexShrink: 0 }} />
              )}
              {favorite && (
                <HeartFilledIcon titleAccess="Favorite" sx={{ fontSize: 14, color: 'text.secondary', flexShrink: 0 }} />
              )}
              {track.artist}
            </Typography>
          }
        />
      </ListItemButton>
    </ListItem>
  );
}

/**
 * Queue panel of the player: what is playing now (highlighted, with the
 * playing state one tap away) followed by everything lined up after it.
 *
 * Every upcoming row carries its own remove button wired to
 * `removeFromQueue(index)` — the index is the row's position in
 * `player.queue`, which is exactly what the context expects.  Tapping a row
 * plays it in place ("play from here"): the songs above it leave the queue
 * the same way they do in every other list of the app.
 */
export default function NPQueue() {
  const player = usePlayer();
  const { current, queue } = player;
  // Readable accent for the "now playing" labels (white accent + light mode
  // would make them invisible on the selected row).
  const { accentFg } = useTheme();
  /** Full listening context so jumping to a row keeps the queue sensible. */
  const context = current ? [current, ...queue] : queue;

  return (
    <Box sx={{ height: '100%', overflowY: 'auto', px: 1, py: 1 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ px: 1, mb: 1 }}
      >
        <Typography variant="subtitle2" color="text.secondary">
          {queue.length
            ? `${queue.length} track${queue.length === 1 ? '' : 's'} up next`
            : 'Up next'}
        </Typography>
        <Stack direction="row" spacing={0.5}>
          <Button
            size="small"
            startIcon={<ShuffleIcon fontSize="small" />}
            onClick={player.toggleShuffle}
            color={player.shuffle ? 'primary' : 'inherit'}
          >
            Shuffle
          </Button>
          <Button
            size="small"
            startIcon={<TrashIcon fontSize="small" />}
            onClick={player.clearQueue}
            disabled={!queue.length}
          >
            Clear
          </Button>
        </Stack>
      </Stack>

      <List dense disablePadding>
        {current && (
          <ListItem disablePadding sx={{ mb: 0.5 }}>
            <ListItemButton
              onClick={player.togglePlay}
              selected
              sx={{ borderRadius: 2, pr: 9 }}
            >
              <ListItemIcon sx={{ minWidth: 52 }}>
                <Artwork
                  src={current.artwork}
                  alt=""
                  iconSize={20}
                  motion={{ album: current.albumName, videoId: current.videoId }}
                  sx={{ width: 46, height: 46, borderRadius: 1.5 }}
                />
              </ListItemIcon>
              <ListItemText
                primary={
                  <MarqueeText
                    text={current.title}
                    variant="body2"
                    sx={{ fontWeight: 700, color: accentFg }}
                  />
                }
                secondary={
                  <Typography
                    variant="caption"
                    noWrap
                    sx={{ display: 'block', color: accentFg, opacity: 0.85 }}
                  >
                    Now playing — {current.artist}
                  </Typography>
                }
              />
            </ListItemButton>
          </ListItem>
        )}

        {queue.map((track, index) => (
          <QueueRow
            key={`${track.videoId}-${index}`}
            track={track}
            index={index}
            context={context}
          />
        ))}
      </List>

      {!queue.length && (
        <Box sx={{ py: 5, textAlign: 'center', px: 3 }}>
          <Typography variant="subtitle1" color="text.secondary">
            Nothing lined up
          </Typography>
          <Typography variant="caption" color="text.disabled">
            Add songs from any list — related songs keep playing automatically.
          </Typography>
        </Box>
      )}
    </Box>
  );
}
