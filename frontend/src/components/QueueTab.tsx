import { Button } from './ui';
import TrackRow from './TrackRow';
import { EmptyState } from './TrackList';
import { GripIcon } from './NPQueue';
import { useDragReorder } from '../hooks/useDragReorder';
import { usePlayer } from '../player/PlayerContext';
import { ShuffleIcon, TrashIcon } from './icons';

/** The old MUI `size="small"` metrics, pinned inline (the kit Button has no size). */
const SMALL_BUTTON = { padding: '4px 18px', fontSize: '0.8125rem' } as const;

/** Up-next list of the active queue. */
export default function QueueTab() {
  const player = usePlayer();
  const drag = useDragReorder({
    itemCount: player.queue.length,
    onMove: player.reorderQueue,
  });

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden px-1 py-1">
      <div className="mb-2 flex flex-row flex-wrap items-center justify-between gap-x-2 gap-y-1 px-1">
        <p className="m-0 text-sm font-medium text-muted">
          {player.queue.length
            ? `${player.queue.length} track${player.queue.length === 1 ? '' : 's'} up next`
            : 'Up next'}
        </p>
        {/* MIGRATION: `size="small"` has no kit equivalent — the small metrics
            ride inline; `color={player.shuffle ? 'primary' : 'inherit'}` became
            the kit's accent default plus an inline `color: 'inherit'` off-state
            so it wins over the classes. */}
        <div className="flex flex-row flex-wrap gap-1">
          <Button
            startIcon={<ShuffleIcon fontSize="small" />}
            onClick={player.toggleShuffle}
            className="font-ui"
            style={{
              ...SMALL_BUTTON,
              ...(player.shuffle ? null : { color: 'inherit' }),
            }}
          >
            Shuffle
          </Button>
          <Button
            startIcon={<TrashIcon fontSize="small" />}
            onClick={player.clearQueue}
            disabled={!player.queue.length}
            className="font-ui"
            style={SMALL_BUTTON}
          >
            Clear
          </Button>
        </div>
      </div>

      {player.queue.length ? (
        <div ref={drag.containerRef}>
          {player.queue.map((track, index) => (
            <div
              key={`${track.videoId}-${index}`}
              {...drag.rowProps(index)}
              className="flex min-w-0 items-center"
            >
              {/* Drag handle — outside the row itself, so grabbing it can
                  never trigger the row's play action. */}
              <button
                type="button"
                aria-label={`Reorder ${track.title} in queue`}
                title="Drag to reorder"
                {...drag.handleProps(index)}
                onClick={(event) => event.stopPropagation()}
                className="inline-grid size-10 shrink-0 cursor-grab place-items-center self-center rounded-full p-1 text-muted transition-colors hover:bg-hover active:cursor-grabbing"
              >
                <GripIcon />
              </button>
              <div className="min-w-0 flex-1">
                <TrackRow track={track} contextTracks={player.queue} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Your queue is empty"
          hint="Add songs from any list, or keep listening — related songs play automatically."
        />
      )}
    </div>
  );
}
