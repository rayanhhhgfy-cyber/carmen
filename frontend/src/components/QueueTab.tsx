import { Button } from './ui';
import TrackList, { EmptyState } from './TrackList';
import { usePlayer } from '../player/PlayerContext';
import { ShuffleIcon, TrashIcon } from './icons';

/** The old MUI `size="small"` metrics, pinned inline (the kit Button has no size). */
const SMALL_BUTTON = { padding: '4px 18px', fontSize: '0.8125rem' } as const;

/** Up-next list of the active queue. */
export default function QueueTab() {
  const player = usePlayer();

  return (
    <div className="h-full overflow-y-auto px-1 py-1">
      <div className="mb-2 flex flex-row items-center justify-between px-1">
        <p className="m-0 text-sm font-medium text-muted">
          {player.queue.length
            ? `${player.queue.length} track${player.queue.length === 1 ? '' : 's'} up next`
            : 'Up next'}
        </p>
        {/* MIGRATION: `size="small"` has no kit equivalent — the small metrics
            ride inline; `color={player.shuffle ? 'primary' : 'inherit'}` became
            the kit's accent default plus an inline `color: 'inherit'` off-state
            so it wins over the classes. */}
        <div className="flex flex-row gap-1">
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
        <TrackList tracks={player.queue} showDividers={false} />
      ) : (
        <EmptyState
          title="Your queue is empty"
          hint="Add songs from any list, or keep listening — related songs play automatically."
        />
      )}
    </div>
  );
}
