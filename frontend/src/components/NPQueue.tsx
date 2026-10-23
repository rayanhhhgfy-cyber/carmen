import { Button, IconButton, List, ListItem, ListItemButton, ListItemIcon, ListItemText } from '../components/ui';

import { useDragReorder, type UseDragReorderResult } from '../hooks/useDragReorder';
import { usePlayer } from '../player/PlayerContext';
import { useTheme } from '../theme/ThemeContext';
import type { Track } from '../types/models';
import { formatTime } from '../utils/format';
import { cn } from '../utils/cn';
import { useFlag } from '../db/flags';
import Artwork from './Artwork';
import MarqueeText from './MarqueeText';
import { CloseIcon, DownloadIcon, ExplicitIcon, HeartFilledIcon, ShuffleIcon, TrashIcon } from './icons';

/** Six-dot grip — no grip glyph exists in the icon set, so it is drawn
 *  inline in the set's own idiom (24px grid, `currentColor` fill). */
export function GripIcon() {
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

/** One upcoming row: tap to jump here, ✕ to drop it from the queue. */
function QueueRow({
  track,
  index,
  context,
  drag,
}: {
  track: Track;
  index: number;
  context: Track[];
  drag: UseDragReorderResult;
}) {
  const player = usePlayer();
  // Per-row subscription: badges flip live as downloads / hearts change.
  const downloaded = useFlag('downloaded', track.videoId);
  const favorite = useFlag('favorite', track.videoId);

  return (
    <ListItem disablePadding className="relative mb-1" {...drag.rowProps(index)}>
      <ListItemButton
        onClick={() => player.playTrack(track, context)}
        className="!rounded-[28px] !pr-[116px]"
      >
        <ListItemIcon sx={{ minWidth: 52 }}>
          <Artwork
            src={track.artwork}
            alt=""
            iconSize={20}
            style={{ width: 46, height: 46, borderRadius: 21 }}
          />
        </ListItemIcon>
        <ListItemText
          primary={track.title}
          primaryClassName="!font-medium"
          secondary={
            <span className="flex items-center gap-1">
              {track.isExplicit && <ExplicitIcon sx={{ fontSize: 13 }} />}
              {/* Passive state badges, kept muted so the meta line stays quiet. */}
              {downloaded && (
                <DownloadIcon titleAccess="Downloaded" sx={{ fontSize: 14, color: 'text.secondary', flexShrink: 0 }} />
              )}
              {favorite && (
                <HeartFilledIcon titleAccess="Favorite" sx={{ fontSize: 14, color: 'text.secondary', flexShrink: 0 }} />
              )}
              {track.artist}
            </span>
          }
          secondaryClassName="!text-body leading-[1.4]"
        />
      </ListItemButton>
      {/* MIGRATION: MUI's `secondaryAction` slot has no kit equivalent — the
          same block, absolutely positioned after the button (right: 16px,
          vertically centred). The row keeps `pr-[72px]` so the text never
          runs underneath it. */}
      <div className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center pr-1">
        {/* Drag handle — a sibling of the row button (never nested in it),
            and its click is swallowed so grabbing it can never play the row. */}
        <button
          type="button"
          aria-label={`Reorder ${track.title} in queue`}
          title="Drag to reorder"
          {...drag.handleProps(index)}
          onClick={(event) => event.stopPropagation()}
          className="mr-1 inline-grid cursor-grab place-items-center rounded-full p-1 text-muted transition-colors hover:bg-hover active:cursor-grabbing"
        >
          <GripIcon />
        </button>
        <span className="mr-2 min-w-[34px] text-right text-xs leading-[1.4] text-muted tabular-nums">
          {track.duration ? formatTime(track.duration) : ''}
        </span>
        <IconButton
          size="small"
          aria-label={`Remove ${track.title} from queue`}
          onClick={() => player.removeFromQueue(index)}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </div>
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
  const drag = useDragReorder({
    itemCount: queue.length,
    onMove: player.reorderQueue,
  });

  return (
    <div ref={drag.containerRef} className="h-full overflow-y-auto px-2 py-2">
      <div className="mb-2 flex items-center justify-between px-2">
        <p className="m-0 text-sm font-medium text-muted">
          {queue.length
            ? `${queue.length} track${queue.length === 1 ? '' : 's'} up next`
            : 'Up next'}
        </p>
        <div className="flex gap-1">
          <Button
            startIcon={<ShuffleIcon fontSize="small" />}
            onClick={player.toggleShuffle}
            className={cn(
              // MUI's `size="small"` has no kit equivalent: 18px inline
              // padding (the theme's paddingInline), 4px block, 13px label.
              '!px-[18px] !py-1 !text-[0.8125rem]',
              !player.shuffle && '!text-body',
            )}
          >
            Shuffle
          </Button>
          <Button
            startIcon={<TrashIcon fontSize="small" />}
            onClick={player.clearQueue}
            disabled={!queue.length}
            className="!px-[18px] !py-1 !text-[0.8125rem]"
          >
            Clear
          </Button>
        </div>
      </div>

      <List dense disablePadding>
        {current && (
          <ListItem disablePadding className="mb-1">
            <ListItemButton
              onClick={player.togglePlay}
              selected
              className="!rounded-[28px] !pr-[72px]"
            >
              <ListItemIcon sx={{ minWidth: 52 }}>
                <Artwork
                  src={current.artwork}
                  alt=""
                  iconSize={20}
                  style={{ width: 46, height: 46, borderRadius: 21 }}
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
                  <span className="block truncate text-xs leading-[1.4] text-accent-fg opacity-85">
                    Now playing — {current.artist}
                  </span>
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
            drag={drag}
          />
        ))}
      </List>

      {!queue.length && (
        <div className="px-6 py-10 text-center">
          <p className="m-0 text-base font-semibold text-muted">
            Nothing lined up
          </p>
          <span className="text-xs leading-[1.4] text-disabled">
            Add songs from any list — related songs keep playing automatically.
          </span>
        </div>
      )}
    </div>
  );
}
