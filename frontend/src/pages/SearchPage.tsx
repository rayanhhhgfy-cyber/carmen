import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Chip,
  Container,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useSearchParams } from 'react-router-dom';

import { apiGet } from '../api';
import { usePlayer } from '../player/PlayerContext';
import { normalizeTrack } from '../utils/track';
import type { Track } from '../types/models';
import MediaCard from '../components/MediaCard';
import TrackList, { EmptyState } from '../components/TrackList';
import { CloseIcon, HistoryIcon, SearchIcon } from '../components/icons';

const FILTERS: { id: string; label: string }[] = [
  { id: '', label: 'All' },
  { id: 'songs', label: 'Songs' },
  { id: 'videos', label: 'Videos' },
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' },
  { id: 'playlists', label: 'Playlists' },
];

/** A raw search result that carries enough fields to play as a song. */
function isTrackLike(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  const record = item as Record<string, unknown>;
  return Boolean(record.videoId) && Boolean(record.artists || record.album || record.duration || record.length);
}

/** Display text of one suggestion entry (`""` when it has none). */
function textOf(entry: unknown): string {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    const record = entry as Record<string, unknown>;
    const text = record.text || record.query;
    if (typeof text === 'string') return text;
  }
  return '';
}

/** React `key` of a result card: first identity field it carries. */
function cardKey(item: Record<string, unknown>, index: number): string {
  const identity = item.videoId || item.browseId || item.playlistId;
  if (typeof identity === 'string' && identity) return identity;
  return String(index);
}

/** Search page with suggestions, type filters and mixed results. */
export default function SearchPage() {
  const player = usePlayer();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('query') || '';

  const [input, setInput] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState('');
  const [results, setResults] = useState<Record<string, unknown>[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<number | undefined>(undefined);

  // Keep the URL in sync so results can be shared / deep linked
  useEffect(() => {
    if (query) setSearchParams({ query }, { replace: true });
    else setSearchParams({}, { replace: true });
  }, [query, setSearchParams]);

  // …and the other way round: arriving here with a *different* query (the
  // "Go to artist" / "Go to album" jumps in the player's ⋯ menu) has to run
  // a new search, because the query lives in this component's state.  A
  // change we made ourselves always matches `queryRef` and is skipped, so a
  // filter the user picked survives their own typing.
  const queryRef = useRef(query);
  queryRef.current = query;
  useEffect(() => {
    const target = searchParams.get('query') || '';
    if (target === queryRef.current) return;
    setQuery(target);
    setInput(target);
    setFilter('');
  }, [searchParams]);

  // Debounced typing -> suggestions
  useEffect(() => {
    window.clearTimeout(debounceRef.current);
    const term = input.trim();
    if (!term || term === query) {
      setSuggestions([]);
      return undefined;
    }
    debounceRef.current = window.setTimeout(() => {
      apiGet('/search/suggestions', { query: term })
        .then((payload) => {
          const list = Array.isArray(payload)
            ? payload.map((entry: unknown) => textOf(entry)).filter((entry: string) => Boolean(entry))
            : [];
          setSuggestions(list.slice(0, 8));
        })
        .catch(() => setSuggestions([]));
    }, 220);
    return () => window.clearTimeout(debounceRef.current);
  }, [input, query]);

  // Run the search
  useEffect(() => {
    const term = query.trim();
    setSuggestions([]);
    if (!term) {
      setResults([]);
      setError(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    apiGet('/search', { query: term, filter: filter || undefined, limit: 25 })
      .then((payload) => {
        if (cancelled) return;
        setResults(Array.isArray(payload) ? (payload as Record<string, unknown>[]) : []);
        setLoading(false);
        setError(null);
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setError(requestError instanceof Error ? requestError.message : String(requestError));
        setResults([]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, filter]);

  const { songs, others } = useMemo(() => {
    const trackItems: Record<string, unknown>[] = [];
    const rest: Record<string, unknown>[] = [];
    results.forEach((item) => {
      if (isTrackLike(item)) trackItems.push(item);
      else rest.push(item);
    });
    return {
      songs: trackItems
        .map((entry) => normalizeTrack(entry))
        .filter((entry): entry is Track => entry !== null),
      others: rest,
    };
  }, [results]);

  const submit = (value?: string) => {
    const term = (value ?? input).trim();
    setShowSuggestions(false);
    setInput(term);
    setQuery(term);
  };

  return (
    <Container maxWidth="lg" sx={{ pt: { xs: 2, md: 3 } }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h5" sx={{ mb: 1.5 }}>
            Search
          </Typography>
          <TextField
            fullWidth
            value={input}
            placeholder="Songs, artists, albums, playlists…"
            onChange={(event) => {
              setInput(event.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => window.setTimeout(() => setShowSuggestions(false), 150)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon color="action" />
                  </InputAdornment>
                ),
                endAdornment: input ? (
                  <InputAdornment position="end">
                    <IconButton size="small" aria-label="Clear search" onClick={() => submit('')}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ) : null,
                sx: { borderRadius: 999, bgcolor: 'background.paper' },
              },
            }}
          />

          {showSuggestions && suggestions.length > 0 && (
            <List
              sx={{
                mt: 0.5,
                bgcolor: 'background.paper',
                borderRadius: 3,
                border: 1,
                borderColor: 'divider',
                py: 0.5,
                position: 'relative',
                zIndex: 2,
              }}
            >
              {suggestions.map((suggestion) => (
                <ListItemButton
                  key={suggestion}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => submit(suggestion)}
                  sx={{ borderRadius: 2, mx: 0.5 }}
                >
                  <HistoryIcon fontSize="small" color="action" sx={{ mr: 1.5 }} />
                  <ListItemText primary={suggestion} primaryTypographyProps={{ variant: 'body2' }} />
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>

        <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', pb: 0.5 }}>
          {FILTERS.map((option) => (
            <Chip
              key={option.id || 'all'}
              label={option.label}
              color={filter === option.id ? 'primary' : 'default'}
              variant={filter === option.id ? 'filled' : 'outlined'}
              onClick={() => setFilter(option.id)}
              sx={{ flexShrink: 0 }}
            />
          ))}
        </Stack>

        {loading && (
          <Stack spacing={1.5}>
            {[0, 1, 2, 3, 4].map((row) => (
              <Stack key={row} direction="row" spacing={2} alignItems="center">
                <Skeleton variant="rounded" width={46} height={46} />
                <Box sx={{ flex: 1 }}>
                  <Skeleton variant="text" width="60%" />
                  <Skeleton variant="text" width="35%" />
                </Box>
              </Stack>
            ))}
          </Stack>
        )}

        {error && <EmptyState title="Search failed" hint={error} />}

        {!loading && !error && query && !results.length && (
          <EmptyState title={`No results for “${query}”`} hint="Check the spelling or try another filter." />
        )}

        {!loading && songs.length > 0 && (
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
              Songs
            </Typography>
            <TrackList tracks={songs} />
          </Box>
        )}

        {!loading && others.length > 0 && (
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
              {songs.length ? 'More results' : 'Results'}
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'repeat(auto-fill, minmax(140px, 1fr))',
                  md: 'repeat(auto-fill, minmax(170px, 1fr))',
                },
                gap: 2.5,
              }}
            >
              {others.map((item, index) => (
                <MediaCard
                  key={cardKey(item, index)}
                  item={item}
                  width="100%"
                  songsContext={songs}
                  onPlaySong={(raw) => player.playTrack(raw, songs)}
                />
              ))}
            </Box>
          </Box>
        )}
      </Stack>
    </Container>
  );
}
