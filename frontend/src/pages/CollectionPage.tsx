import { useEffect, useState } from 'react';
import { Button, Collapse, Container, IconButton, Shimmer } from '../components/ui';
import { useNavigate, useParams } from 'react-router-dom';

import { apiGet } from '../api';
import { useDownloads } from '../hooks';
import { isDownloaded } from '../offline/source';
import { usePlayer } from '../player/PlayerContext';
import { notify } from '../utils/downloadsStore';
import { normalizeList, pickArtwork } from '../utils/track';
import type { Thumbnail } from '../types/models';
import Artwork from '../components/Artwork';
import TrackList, { EmptyState } from '../components/TrackList';
import {
  ArrowBackIcon,
  CheckIcon,
  DownloadIcon,
  ExpandMoreIcon,
  PlayArrowIcon,
  ShuffleIcon,
} from '../components/icons';

/** Any candidate shape `pickArtwork` understands; the payload is untyped JSON. */
type ArtworkInput =
  | string
  | null
  | undefined
  | { thumbnails?: Thumbnail[]; url?: string };

/** Album / playlist detail page with a collapsible description. */
export default function CollectionPage() {
  const { kind, id } = useParams();
  const navigate = useNavigate();
  const player = usePlayer();
  const { jobs } = useDownloads();

  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [savingCollection, setSavingCollection] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [descriptionOpen, setDescriptionOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);

    const request =
      kind === 'album'
        ? apiGet(`/browsing/album/${id}`)
        : apiGet(`/playlists/${id}`, { limit: 100 });

    request
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setError(requestError instanceof Error ? requestError.message : String(requestError));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [kind, id]);

  if (loading) {
    return (
      <Container maxWidth="lg" className="pt-6">
        <div className="flex flex-col gap-6 sm:flex-row">
          <Shimmer variant="rounded" width={220} height={220} />
          <div className="flex-1">
            <Shimmer variant="text" width="60%" height={44} className="mb-[5px]" />
            <Shimmer variant="text" width="35%" className="mb-[5px]" />
            <Shimmer variant="text" width="25%" />
          </div>
        </div>
      </Container>
    );
  }

  if (error || !data) {
    return (
      <Container maxWidth="lg" className="pt-8">
        <EmptyState title={`Could not load this ${kind}`} hint={error} />
      </Container>
    );
  }

  const tracks = normalizeList(data.tracks || data.items || []);
  const artwork = pickArtwork(data.thumbnails as ArtworkInput, data.thumbnail as ArtworkInput);
  // The API is inconsistent: `artists` is either a list of `{ name }` or a
  // plain `author` string on the payload.
  const artistEntries = Array.isArray(data.artists) ? data.artists : null;
  const artists = artistEntries
    ? artistEntries
        .map((entry: unknown) =>
          entry && typeof entry === 'object'
            ? (entry as Record<string, unknown>).name
            : undefined,
        )
        .filter((name): name is string => typeof name === 'string' && Boolean(name))
        .join(', ')
    : typeof data.author === 'string'
      ? data.author
      : '';
  const description = typeof data.description === 'string' ? data.description : '';
  const title = data.title == null ? '' : String(data.title);

  const metaLine = [
    data.year,
    `${tracks.length} track${tracks.length === 1 ? '' : 's'}`,
    data.trackCount && data.trackCount !== tracks.length ? `${data.trackCount} songs` : null,
    data.duration,
  ]
    .filter(Boolean)
    .join('  •  ');

  // ── Download all ──────────────────────────────────────────────────────
  // Same aggregation as the library's PlaylistDetailView: done jobs in
  // the shared downloads store plus what the offline catalogue already
  // holds (a track saved in an earlier session has no job anymore).
  const downloadedCount = tracks.filter(
    (track) => isDownloaded(track.videoId) || jobs[track.videoId]?.status === 'done',
  ).length;
  const downloadInFlight = tracks.some((track) => jobs[track.videoId]?.status === 'running');
  const allDownloaded = tracks.length > 0 && downloadedCount === tracks.length;

  const handleDownloadAll = async () => {
    if (savingCollection || downloadInFlight || allDownloaded) return;
    setSavingCollection(true);
    try {
      // The pipeline is heavy — it loads lazily on first download
      // interaction, like every other download trigger in the app.
      const [{ ensureCollectionPlaylist }, downloads] = await Promise.all([
        import('../utils/collectionPlaylist'),
        import('../utils/downloads'),
      ]);
      // Save the collection as a library playlist first (reused when an
      // identical one exists), so the songs land somewhere reopenable —
      // then download through the existing pipeline.
      await ensureCollectionPlaylist(title || (kind === 'album' ? 'Album' : 'Playlist'), tracks);
      const started = downloads.startPlaylistDownload(tracks);
      if (started > 0) {
        notify(
          'success',
          `Downloading ${started} track${started === 1 ? '' : 's'} from “${title}”`,
        );
      } else {
        notify('info', 'Nothing new to download — every track is already saved or downloading');
      }
    } catch (downloadError) {
      console.warn('[collection] download all failed', downloadError);
      notify('error', 'Could not save this collection to your library');
    } finally {
      setSavingCollection(false);
    }
  };

  return (
    <Container maxWidth="lg" className="pt-3 md:pt-6">
      <IconButton aria-label="Back" onClick={() => navigate(-1)} className="mb-2">
        <ArrowBackIcon />
      </IconButton>

      <div className="mb-6 flex flex-col gap-6 sm:flex-row">
        <Artwork
          src={artwork}
          alt=""
          iconSize={64}
          className="w-[160px] sm:w-[220px] h-[160px] sm:h-[220px] mx-auto sm:mx-0"
          style={{
            borderRadius: 42,
            boxShadow: 'var(--shadow-elev-4)',
            flexShrink: 0,
          }}
        />
        <div className="min-w-0 flex-1 text-center sm:text-left">
          {/* MUI's `overline` variant: 12px, uppercase, the tall 2.66 line box. */}
          <span className="block text-xs uppercase leading-[2.66] text-muted">
            {kind === 'album' ? 'Album' : 'Playlist'}
          </span>
          <h5 className="m-0 text-2xl font-extrabold">{title}</h5>
          {artists && (
            <p className="m-0 mt-2 text-base leading-[1.5] text-muted">{artists}</p>
          )}
          <span className="mt-2 block text-xs leading-[1.4] text-muted">{metaLine}</span>

          <div className="mt-4 flex flex-row flex-wrap justify-center gap-2 sm:justify-start">
            <Button
              variant="contained"
              startIcon={<PlayArrowIcon />}
              disabled={!tracks.length}
              onClick={() => player.playAll(tracks, 0)}
            >
              Play all
            </Button>
            <Button
              startIcon={<ShuffleIcon />}
              disabled={!tracks.length}
              className="border border-accent/50"
              onClick={() => {
                if (!player.shuffle) player.toggleShuffle();
                player.playAll(tracks, Math.floor(Math.random() * tracks.length));
              }}
            >
              Shuffle
            </Button>
            {tracks.length > 0 && (
              <Button
                variant="text"
                startIcon={allDownloaded ? <CheckIcon /> : <DownloadIcon />}
                disabled={savingCollection || downloadInFlight || allDownloaded}
                className="border border-accent/50"
                onClick={() => void handleDownloadAll()}
              >
                {downloadInFlight
                  ? `Downloading ${downloadedCount}/${tracks.length}`
                  : allDownloaded
                    ? 'Downloaded'
                    : savingCollection
                      ? 'Saving…'
                      : 'Download all'}
              </Button>
            )}
          </div>

          {downloadInFlight && (
            <div className="mx-auto mt-3 max-w-[420px] sm:mx-0">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={tracks.length}
                aria-valuenow={downloadedCount}
                aria-label="Collection download progress"
                className="h-1 w-full overflow-hidden rounded-full bg-hover"
              >
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-300"
                  style={{
                    width: `${tracks.length ? (downloadedCount / tracks.length) * 100 : 0}%`,
                  }}
                />
              </div>
              <span className="mt-1 block text-xs leading-[1.4] text-muted">
                Downloading {downloadedCount}/{tracks.length}
              </span>
            </div>
          )}

          {description && (
            <div className="mt-3 text-center sm:text-left">
              <Button
                endIcon={
                  <ExpandMoreIcon
                    sx={{ transform: descriptionOpen ? 'rotate(180deg)' : 'none', transition: 'transform 200ms' }}
                  />
                }
                onClick={() => setDescriptionOpen((value) => !value)}
              >
                {descriptionOpen ? 'Hide description' : 'About'}
              </Button>
              <Collapse in={descriptionOpen}>
                <p className="m-0 mt-2 max-h-[220px] overflow-y-auto whitespace-pre-line text-left text-sm leading-[1.43] text-muted">
                  {description}
                </p>
              </Collapse>
            </div>
          )}
        </div>
      </div>

      {tracks.length ? (
        <TrackList tracks={tracks} numbered={kind === 'album'} />
      ) : (
        <EmptyState title="Nothing to play here" hint="This collection has no playable tracks." />
      )}
    </Container>
  );
}
