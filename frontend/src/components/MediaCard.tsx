import { useNavigate } from 'react-router-dom';

import { useFlags } from '../db/flags';
import { primaryArtwork } from '../utils/track';
import Artwork from './Artwork';
import { Chip } from './ui';
import { DownloadIcon, HeartFilledIcon, PlayArrowIcon } from './icons';
import MarqueeText from './MarqueeText';

/** Route / action to run when a browse item is tapped. */
export interface CardAction {
  kind: 'song' | 'playlist' | 'album' | 'artist';
  key: string;
}

/**
 * Classify an arbitrary browse item (home rows, search results, related).
 * Returns the route / action to run when the card is tapped.
 */
export function resolveCard(item: unknown): CardAction | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;

  if (
    record.videoId &&
    (record.artists || record.album || record.duration || record.length)
  ) {
    return { kind: 'song', key: `song-${String(record.videoId)}` };
  }
  if (record.playlistId) {
    return { kind: 'playlist', key: `playlist-${String(record.playlistId)}` };
  }
  if (typeof record.browseId === 'string' && record.browseId.startsWith('MPRE')) {
    return { kind: 'album', key: `album-${record.browseId}` };
  }
  if (typeof record.browseId === 'string' && record.browseId.startsWith('UC')) {
    return { kind: 'artist', key: `artist-${record.browseId}` };
  }
  if (record.videoId) return { kind: 'song', key: `song-${String(record.videoId)}` };
  if (record.browseId) return { kind: 'album', key: `album-${record.browseId}` };
  return null;
}

/** Callback invoked when a song card is tapped: the raw payload plus an optional play context. */
export type MediaCardPlaySong = (
  item: Record<string, unknown>,
  context: unknown[] | null
) => void;

/** Props for the card shelf/grid tile. Payloads stay `unknown`; narrowing happens here. */
export interface MediaCardProps {
  item: unknown;
  onPlaySong?: MediaCardPlaySong | null;
  /** Ordered list the played song belongs to (e.g. a shelf's songs). */
  songsContext?: unknown[] | null;
  width?: number | string;
}

/** MUI's default elevation shadows (this theme never overrides them). */
const ELEVATION_1 =
  '0px 2px 1px -1px rgba(0, 0, 0, 0.2), 0px 1px 1px 0px rgba(0, 0, 0, 0.14), 0px 1px 3px 0px rgba(0, 0, 0, 0.12)';
const ELEVATION_3 =
  '0px 3px 3px -2px rgba(0, 0, 0, 0.2), 0px 3px 4px 0px rgba(0, 0, 0, 0.14), 0px 1px 8px 0px rgba(0, 0, 0, 0.12)';

export default function MediaCard({
  item,
  onPlaySong,
  songsContext = null,
  width = 156,
}: MediaCardProps) {
  const navigate = useNavigate();
  const card = resolveCard(item);
  // Badges on song tiles (home / search shelves): one store read per card,
  // live like everywhere else.
  const flags = useFlags();
  if (!card) return null;

  const record = (item ?? {}) as Record<string, unknown>;
  const videoId = typeof record.videoId === 'string' ? record.videoId : null;
  const isDownloaded = Boolean(videoId) && flags.downloaded.has(videoId as string);
  const isFavorite = Boolean(videoId) && flags.favorite.has(videoId as string);
  const isFluid = typeof width !== 'number';
  const boxWidth = isFluid ? width : `${width}px`;

  const artwork = primaryArtwork(item);
  const title =
    (typeof record.title === 'string' && record.title) || 'Untitled';

  // Subtitle: explicit artist, joined artist list, or a fallback chain.
  let subtitle = '';
  if (typeof record.artist === 'string' && record.artist) {
    subtitle = record.artist;
  } else if (Array.isArray(record.artists)) {
    subtitle = record.artists
      .map((artist) =>
        artist && typeof artist === 'object'
          ? (artist as Record<string, unknown>).name
          : undefined,
      )
      .filter((name): name is string => typeof name === 'string' && Boolean(name))
      .join(', ');
  } else if (typeof record.author === 'string' && record.author) {
    subtitle = record.author;
  } else if (typeof record.description === 'string' && record.description) {
    subtitle = record.description;
  } else if (typeof record.type === 'string' && record.type) {
    subtitle = record.type;
  }

  const handleClick = () => {
    if (card.kind === 'song' && onPlaySong) {
      onPlaySong(record, songsContext);
    } else if (card.kind === 'album') {
      navigate(`/collection/album/${String(record.browseId)}`);
    } else if (card.kind === 'playlist') {
      navigate(`/collection/playlist/${String(record.playlistId)}`);
    } else if (card.kind === 'artist') {
      navigate(
        `/search?query=${encodeURIComponent(
          (typeof record.title === 'string' && record.title) || '',
        )}`,
      );
    }
  };

  const shape = card.kind === 'song' ? 'rounded' : 'circle';

  // Grid/flex children default to an automatic minimum of their min-content
  // width — a nowrap title would inflate the card over its neighbours and
  // defeat MarqueeText's overflow measurement (`min-w-0` keeps it honest).
  // The stretch has to be explicit: WebKit's UA stylesheet pins
  // `align-items: flex-start` on <button>, so on older macOS WKWebView
  // (Tauri) the text cell would otherwise size to the full nowrap title
  // instead of the card, and the marquee would never engage.
  return (
    <button
      type="button"
      onClick={handleClick}
      className="m-0 flex min-w-0 cursor-pointer snap-start flex-col items-stretch gap-2 border-none bg-transparent p-0 text-left font-ui hover:[&_.card-art]:[transform:scale(1.04)] hover:[&_.card-play]:translate-y-0 hover:[&_.card-play]:opacity-100"
      style={{ width: boxWidth, flex: isFluid ? 'auto' : `0 0 ${boxWidth}` }}
    >
      <div className="relative aspect-square w-full">
        <Artwork
          className="card-art"
          src={artwork}
          alt=""
          iconSize={44}
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: shape === 'circle' ? '50%' : 28,
            transition: 'transform 220ms ease',
            boxShadow: ELEVATION_1,
          }}
        />
        {(isDownloaded || isFavorite) && (
          <div className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-[rgba(0,0,0,0.62)] px-[6px] py-0.5 text-white">
            {isDownloaded && <DownloadIcon sx={{ fontSize: 13 }} />}
            {isFavorite && <HeartFilledIcon sx={{ fontSize: 13 }} />}
          </div>
        )}
        {card.kind === 'song' && (
          <div
            className="card-play absolute bottom-1.5 right-1.5 grid h-9 w-9 translate-y-1.5 place-items-center rounded-full bg-accent text-accent-contrast opacity-0 transition-all duration-200 ease-[ease]"
            style={{ boxShadow: ELEVATION_3 }}
          >
            <PlayArrowIcon />
          </div>
        )}
      </div>
      <div className="w-full min-w-0">
        <MarqueeText text={title} variant="body2" sx={{ fontWeight: 600 }} />
        <span className="block truncate text-xs leading-[1.4] text-muted">
          {subtitle || (card.kind === 'song' ? 'Song' : card.kind)}
        </span>
      </div>
      {record.isExplicit === true && (
        <Chip label="E" size="small" variant="outlined" style={{ height: 18 }} />
      )}
    </button>
  );
}
