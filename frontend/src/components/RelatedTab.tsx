import { Shimmer } from './ui';
import TrackList, { EmptyState } from './TrackList';
import { usePlayer } from '../player/PlayerContext';

/**
 * Contextually related songs of the active track.  These are also used for
 * continuous auto-play when the queue runs out.
 */
export default function RelatedTab() {
  const player = usePlayer();
  const { related, relatedFor, current } = player;
  const loading = Boolean(current && relatedFor !== current.videoId);

  if (loading) {
    return (
      <div className="px-2 py-1">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="flex flex-row items-center gap-4 py-2">
            <Shimmer variant="rounded" width={44} height={44} />
            <div className="flex-1">
              <Shimmer width="70%" />
              <Shimmer width="40%" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!related.length) {
    return <EmptyState title="No related songs found" hint="Try another track." />;
  }

  return (
    <div className="h-full overflow-y-auto px-1 py-1">
      <p className="m-0 mb-1 px-1 text-sm font-medium text-muted">
        More like this — plays automatically when the queue ends
      </p>
      <TrackList tracks={related} showDividers={false} />
    </div>
  );
}
