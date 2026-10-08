import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Collapse,
  Container,
  IconButton,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';

import { apiGet } from '../api';
import { usePlayer } from '../player/PlayerContext';
import { normalizeList, pickArtwork } from '../utils/track';
import type { Thumbnail } from '../types/models';
import Artwork from '../components/Artwork';
import TrackList, { EmptyState } from '../components/TrackList';
import { ArrowBackIcon, ExpandMoreIcon, PlayArrowIcon, ShuffleIcon } from '../components/icons';

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

  const [data, setData] = useState<Record<string, unknown> | null>(null);
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
      <Container maxWidth="lg" sx={{ pt: 3 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3}>
          <Skeleton variant="rounded" width={220} height={220} />
          <Box sx={{ flex: 1 }}>
            <Skeleton variant="text" width="60%" height={44} />
            <Skeleton variant="text" width="35%" />
            <Skeleton variant="text" width="25%" />
          </Box>
        </Stack>
      </Container>
    );
  }

  if (error || !data) {
    return (
      <Container maxWidth="lg" sx={{ pt: 4 }}>
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

  return (
    <Container maxWidth="lg" sx={{ pt: { xs: 1.5, md: 3 } }}>
      <IconButton aria-label="Back" onClick={() => navigate(-1)} sx={{ mb: 1 }}>
        <ArrowBackIcon />
      </IconButton>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} sx={{ mb: 3 }}>
        <Artwork
          src={artwork}
          alt=""
          iconSize={64}
          motion={kind === 'album' ? { album: title } : null}
          sx={{
            width: { xs: 160, sm: 220 },
            height: { xs: 160, sm: 220 },
            borderRadius: 3,
            boxShadow: 4,
            mx: { xs: 'auto', sm: 0 },
            flexShrink: 0,
          }}
        />
        <Box sx={{ flex: 1, minWidth: 0, textAlign: { xs: 'center', sm: 'left' } }}>
          <Typography variant="overline" color="text.secondary">
            {kind === 'album' ? 'Album' : 'Playlist'}
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            {title}
          </Typography>
          {artists && (
            <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
              {artists}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {metaLine}
          </Typography>

          <Stack direction="row" spacing={1} sx={{ mt: 2, justifyContent: { xs: 'center', sm: 'flex-start' } }}>
            <Button
              variant="contained"
              startIcon={<PlayArrowIcon />}
              disabled={!tracks.length}
              onClick={() => player.playAll(tracks, 0)}
            >
              Play all
            </Button>
            <Button
              variant="outlined"
              startIcon={<ShuffleIcon />}
              disabled={!tracks.length}
              onClick={() => {
                if (!player.shuffle) player.toggleShuffle();
                player.playAll(tracks, Math.floor(Math.random() * tracks.length));
              }}
            >
              Shuffle
            </Button>
          </Stack>

          {description && (
            <Box sx={{ mt: 1.5, textAlign: { xs: 'center', sm: 'left' } }}>
              <Button
                size="small"
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
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{
                    mt: 1,
                    whiteSpace: 'pre-line',
                    maxHeight: 220,
                    overflowY: 'auto',
                    textAlign: 'left',
                  }}
                >
                  {description}
                </Typography>
              </Collapse>
            </Box>
          )}
        </Box>
      </Stack>

      {tracks.length ? (
        <TrackList tracks={tracks} numbered={kind === 'album'} />
      ) : (
        <EmptyState title="Nothing to play here" hint="This collection has no playable tracks." />
      )}
    </Container>
  );
}
