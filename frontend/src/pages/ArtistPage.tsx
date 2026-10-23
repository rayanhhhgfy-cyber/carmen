import { useEffect, useState, type ReactNode } from 'react';
import { Button, Collapse, Container, IconButton, Shimmer } from '../components/ui';
import { useNavigate, useParams } from 'react-router-dom';

import { apiGet } from '../api';
import { usePlayer } from '../player/PlayerContext';
import { normalizeList, pickArtwork } from '../utils/track';
import type { Thumbnail } from '../types/models';
import Artwork from '../components/Artwork';
import MediaCard from '../components/MediaCard';
import TrackList, { EmptyState } from '../components/TrackList';
import { ArrowBackIcon, ExpandMoreIcon, PlayArrowIcon, ShuffleIcon } from '../components/icons';

/** Any candidate shape `pickArtwork` understands; the payload is untyped JSON. */
type ArtworkInput =
  | string
  | null
  | undefined
  | { thumbnails?: Thumbnail[]; url?: string };

/** One shelf of the artist payload — `results` is always a list of raw items. */
function shelfResults(shelf: unknown): Record<string, unknown>[] {
  if (!shelf || typeof shelf !== 'object') return [];
  const results = (shelf as Record<string, unknown>).results;
  return Array.isArray(results) ? (results as Record<string, unknown>[]) : [];
}

/** View-all params of a shelf, when YouTube attached them. */
function shelfParams(shelf: unknown): string | null {
  if (!shelf || typeof shelf !== 'object') return null;
  const params = (shelf as Record<string, unknown>).params;
  return typeof params === 'string' && params ? params : null;
}

/** Auto-fill card grid — the same one the search page's results use. */
function CardGrid({ items, playContext }: { items: Record<string, unknown>[]; playContext?: unknown[] }) {
  const player = usePlayer();
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-5 md:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
      {items.map((item, index) => (
        <MediaCard
          key={
            typeof item.browseId === 'string' && item.browseId
              ? item.browseId
              : typeof item.videoId === 'string' && item.videoId
                ? item.videoId
                : String(index)
          }
          item={item}
          width="100%"
          songsContext={playContext ?? null}
          onPlaySong={(raw, context) => player.playTrack(raw, context)}
        />
      ))}
    </div>
  );
}

function Shelf({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h6 className="m-0 text-xl font-extrabold leading-[1.6] tracking-[-0.02em]">{title}</h6>
      {children}
    </section>
  );
}

/**
 * Artist page — the destination of every artist card.
 *
 * Header (avatar, name, stats, About) plus the shelves YouTube returns:
 * top songs as a playable list, then albums / singles / videos / related
 * artists as card grids.
 *
 * The artist payload only carries the first ~10 releases per shelf. When a
 * shelf advertises `params`, the complete albums / singles list is fetched
 * through `/browsing/artist/{id}/albums?params=…&limit=100`; until that
 * backend route recovers (it currently errors upstream — the page treats it
 * as optional) the grid simply keeps the shelf's slice.
 */
export default function ArtistPage() {
  const { channelId } = useParams();
  const navigate = useNavigate();
  const player = usePlayer();

  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [albums, setAlbums] = useState<Record<string, unknown>[] | null>(null);
  const [singles, setSingles] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [descriptionOpen, setDescriptionOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    setAlbums(null);
    setSingles(null);
    setDescriptionOpen(false);

    /** Complete a shelf through its view-all params; failures keep the slice. */
    const expand = (
      shelf: unknown,
      setter: (items: Record<string, unknown>[]) => void,
    ) => {
      const params = shelfParams(shelf);
      if (!params || !channelId) return;
      apiGet(`/browsing/artist/${channelId}/albums`, { params, limit: 100 })
        .then((list) => {
          if (!cancelled && Array.isArray(list) && list.length) {
            setter(list as Record<string, unknown>[]);
          }
        })
        .catch(() => {
          /* the shelf's own slice already renders */
        });
    };

    apiGet(`/browsing/artist/${channelId}`)
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setLoading(false);
        if (payload && typeof payload === 'object') {
          expand(payload.albums, setAlbums);
          expand(payload.singles, setSingles);
        }
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setError(requestError instanceof Error ? requestError.message : String(requestError));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [channelId]);

  if (loading) {
    return (
      <Container maxWidth="lg" className="pt-6">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
          <Shimmer variant="circular" width={180} height={180} />
          <div className="flex-1">
            <Shimmer variant="text" width="50%" height={40} className="mb-[5px]" />
            <Shimmer variant="text" width="35%" className="mb-[5px]" />
            <Shimmer variant="text" width="60%" />
          </div>
        </div>
      </Container>
    );
  }

  if (error || !data) {
    return (
      <Container maxWidth="lg" className="pt-8">
        <EmptyState title="Could not load this artist" hint={error} />
      </Container>
    );
  }

  const name = typeof data.name === 'string' ? data.name : '';
  const artwork = pickArtwork(data.thumbnails as ArtworkInput);
  const description = typeof data.description === 'string' ? data.description : '';
  const songs = normalizeList(shelfResults(data.songs));
  const albumItems = albums ?? shelfResults(data.albums);
  const singleItems = singles ?? shelfResults(data.singles);
  const videoItems = shelfResults(data.videos);
  const relatedItems = shelfResults(data.related);

  const metaLine = [
    data.subscribers,
    data.monthlyListeners ? `${data.monthlyListeners} monthly listeners` : null,
    data.views,
  ]
    .filter(Boolean)
    .join('  •  ');

  return (
    <Container maxWidth="lg" className="pt-3 md:pt-6">
      <IconButton aria-label="Back" onClick={() => navigate(-1)} className="mb-2">
        <ArrowBackIcon />
      </IconButton>

      <div className="mb-6 flex flex-col items-center gap-6 text-center sm:flex-row sm:items-start sm:text-left">
        <Artwork
          src={artwork}
          alt=""
          iconSize={64}
          className="h-[160px] w-[160px] shrink-0 sm:h-[200px] sm:w-[200px]"
          style={{ borderRadius: '50%', boxShadow: 'var(--shadow-elev-4)' }}
        />
        <div className="min-w-0 flex-1">
          <span className="block text-xs uppercase leading-[2.66] text-muted">Artist</span>
          <h5 className="m-0 text-2xl font-extrabold">{name}</h5>
          {metaLine && <span className="mt-2 block text-xs leading-[1.4] text-muted">{metaLine}</span>}

          <div className="mt-4 flex flex-row flex-wrap justify-center gap-2 sm:justify-start">
            <Button
              variant="contained"
              startIcon={<PlayArrowIcon />}
              disabled={!songs.length}
              onClick={() => player.playAll(songs, 0)}
            >
              Play all
            </Button>
            <Button
              startIcon={<ShuffleIcon />}
              disabled={!songs.length}
              className="border border-accent/50"
              onClick={() => {
                if (!player.shuffle) player.toggleShuffle();
                player.playAll(songs, Math.floor(Math.random() * songs.length));
              }}
            >
              Shuffle
            </Button>
          </div>

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

      <div className="flex flex-col gap-8">
        {songs.length > 0 && (
          <Shelf title="Popular">
            <TrackList tracks={songs} />
          </Shelf>
        )}
        {albumItems.length > 0 && (
          <Shelf title="Albums">
            <CardGrid items={albumItems} />
          </Shelf>
        )}
        {singleItems.length > 0 && (
          <Shelf title="Singles & EPs">
            <CardGrid items={singleItems} />
          </Shelf>
        )}
        {videoItems.length > 0 && (
          <Shelf title="Videos">
            <CardGrid items={videoItems} playContext={videoItems} />
          </Shelf>
        )}
        {relatedItems.length > 0 && (
          <Shelf title="Fans might also like">
            <CardGrid items={relatedItems} />
          </Shelf>
        )}
        {!songs.length && !albumItems.length && !singleItems.length && !videoItems.length && (
          <EmptyState title="Nothing here yet" hint="This artist page has no playable sections." />
        )}
      </div>
    </Container>
  );
}
