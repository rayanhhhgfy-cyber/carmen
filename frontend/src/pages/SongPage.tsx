import { useEffect, useState } from 'react';
import { Button, Container, Spinner } from '../components/ui';
import { useNavigate, useParams } from 'react-router-dom';

import { apiGet } from '../api';
import { usePlayer } from '../player/PlayerContext';
import { normalizeTrack } from '../utils/track';
import { ArrowBackIcon } from '../components/icons';
import { EmptyState } from '../components/TrackList';

/**
 * Deep-link target of a shared song (`#/song/<videoId>`).
 *
 * Share links ride in the query string (`?song=…`) so a crawler can render
 * the Open Graph preview (see `server/share.py`); `main.tsx` folds that query
 * into this hash route before React mounts. The page fetches the track once,
 * starts playback with the full player open, then replaces itself with the
 * home route — opening a shared link should feel like pressing play on
 * someone else's phone, not like landing on a page.
 */
export default function SongPage() {
  const { videoId } = useParams();
  const navigate = useNavigate();
  const player = usePlayer();
  const [error, setError] = useState<string | null>(null);

  // Deliberately keyed on `videoId` only: `player` is a fresh object every
  // render, and re-running would restart the song on each pass. Playback outlives this route (the provider lives in Layout).
  useEffect(() => {
    if (!videoId) {
      setError('No song in this link.');
      return undefined;
    }
    let cancelled = false;

    apiGet(`/browsing/track/${videoId}`)
      .then((payload) => {
        if (cancelled) return;
        const track = normalizeTrack(payload);
        if (!track) {
          setError('This song is unavailable.');
          return;
        }
        player.playTrack(track, [track], { openSheet: true });
        navigate('/', { replace: true });
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setError(requestError instanceof Error ? requestError.message : String(requestError));
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  if (error) {
    return (
      <Container maxWidth="sm" className="pt-8">
        <EmptyState title="Could not open this song" hint={error} />
        <div className="mt-4 flex justify-center">
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/')}>
            Back to home
          </Button>
        </div>
      </Container>
    );
  }

  return (
    <Container maxWidth="sm" className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
      <Spinner size={40} />
      <span className="text-sm text-muted">Starting playback…</span>
    </Container>
  );
}
