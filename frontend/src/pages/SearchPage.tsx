import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Chip,
  Container,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Shimmer,
  TextField,
} from '../components/ui';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { apiGet } from '../api';
import { usePlayer } from '../player/PlayerContext';
import { normalizeTrack } from '../utils/track';
import { loadSearchHistory, rememberSearch } from '../utils/searchHistory';
import { detectImportLink } from '../services/spotifyConvert';
import type { Track } from '../types/models';
import MediaCard from '../components/MediaCard';
import TrackList, { EmptyState } from '../components/TrackList';
import SpotifyImportDialog, { importKindLabel } from './library/SpotifyImportDialog';
import { CloseIcon, HistoryIcon, SearchIcon } from '../components/icons';
import { cn } from '../utils/cn';

const FILTERS: { id: string; label: string }[] = [
  { id: '', label: 'All' },
  { id: 'songs', label: 'Songs' },
  { id: 'videos', label: 'Videos' },
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' },
  { id: 'playlists', label: 'Playlists' },
];

/**
 * Search opens on **Songs** — the filter a music player's search is about.
 * `All` is one chip tap away and survives in the URL as `?filter=all`;
 * every other chip deep-links as `?filter=<id>`.
 */
const DEFAULT_FILTER = 'songs';
const FILTER_IDS = new Set(FILTERS.map((option) => option.id));

/** Active filter from the URL; unknown or missing values land on Songs. */
function filterFromParams(params: URLSearchParams): string {
  const raw = params.get('filter');
  if (raw === 'all') return '';
  if (raw && FILTER_IDS.has(raw)) return raw;
  return DEFAULT_FILTER;
}

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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('query') || '';

  const [input, setInput] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState(() => filterFromParams(searchParams));
  const [results, setResults] = useState<Record<string, unknown>[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>(loadSearchHistory);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [importUrl, setImportUrl] = useState<string | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  // A pasted import link (Spotify / Apple / YouTube / Carmen share) is not
  // a search at all — offer the import flow for it instead.
  const detectedImport = useMemo(() => detectImportLink(input.trim()), [input]);

  // Keep the URL in sync so results can be shared / deep linked — the
  // active filter rides along as `?filter=` (omitted while it is the
  // default Songs tab, spelled `all` for the All tab).
  useEffect(() => {
    const next = new URLSearchParams();
    if (query) next.set('query', query);
    if (filter !== DEFAULT_FILTER) next.set('filter', filter || 'all');
    setSearchParams(next, { replace: true });
  }, [query, filter, setSearchParams]);

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
    // an externally arrived search starts from the URL's filter — which
    // defaults back to Songs when the link carries none
    setFilter(filterFromParams(searchParams));
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
    apiGet('/search', { query: term, filter: filter || undefined, limit: 100 })
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
    if (term) setHistory(rememberSearch(term));
  };

  // Dropdown rows: the recent searches first (matching what's typed, or all
  // of them while the field is empty), then the server's suggestions —
  // deduped case-insensitively and typed so the key never collides.
  const entries = useMemo(() => {
    const needle = input.trim().toLowerCase();
    const seen = new Set<string>();
    const rows: { kind: 'history' | 'suggestion'; text: string }[] = [];
    for (const text of history) {
      if (needle && !text.toLowerCase().includes(needle)) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ kind: 'history', text });
    }
    for (const text of suggestions) {
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ kind: 'suggestion', text });
    }
    return rows;
  }, [history, suggestions, input]);

  return (
    <Container maxWidth="lg" className="pt-4 md:pt-6">
      <div className="flex flex-col gap-4">
        <div>
          <h5 className="m-0 mb-3 text-2xl font-bold">Search</h5>
          <TextField
            fullWidth
            value={input}
            placeholder="Songs, artists, albums, playlists…"
            onChange={(event) => {
              setInput(event.target.value);
              setShowSuggestions(true);
            }}
            startAdornment={<SearchIcon color="action" />}
            endAdornment={
              input ? (
                <IconButton size="small" aria-label="Clear search" onClick={() => submit('')}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              ) : null
            }
            className="[&_div]:!rounded-full"
            inputProps={{
              // The pill field used to carry these on the input slot.
              onFocus: () => setShowSuggestions(true),
              onBlur: () => window.setTimeout(() => setShowSuggestions(false), 150),
              onKeyDown: (event) => {
                if (event.key === 'Enter') submit();
              },
            }}
          />

          {detectedImport && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-[28px] border border-line bg-surface px-4 py-2.5">
              <p className="m-0 min-w-0 flex-1 text-sm leading-6">
                Link detected — import this {importKindLabel(detectedImport.kind)}
              </p>
              <Button
                variant="contained"
                onClick={() => setImportUrl(input.trim())}
                className="shrink-0"
              >
                Import
              </Button>
            </div>
          )}

          {showSuggestions && entries.length > 0 && (
            <List className="relative z-[2] mt-1 rounded-[42px] border border-line bg-surface !py-1">
              {entries.map((entry) => (
                <ListItemButton
                  key={`${entry.kind}:${entry.text}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => submit(entry.text)}
                  className="mx-1 !rounded-[28px]"
                >
                  {/* history keeps the clock; suggestions get the magnifier */}
                  {entry.kind === 'history' ? (
                    <HistoryIcon fontSize="small" color="action" sx={{ mr: 1.5 }} />
                  ) : (
                    <SearchIcon fontSize="small" color="action" sx={{ mr: 1.5 }} />
                  )}
                  <ListItemText primary={entry.text} primaryClassName="font-normal" />
                </ListItemButton>
              ))}
            </List>
          )}
        </div>

        <div className="flex flex-row gap-2 overflow-x-auto pb-1">
          {FILTERS.map((option) => (
            <Chip
              key={option.id || 'all'}
              label={option.label}
              variant={filter === option.id ? 'filled' : 'outlined'}
              onClick={() => setFilter(option.id)}
              className={cn(
                'flex-shrink-0',
                filter === option.id && '!border-transparent !bg-accent !text-accent-contrast',
              )}
            />
          ))}
        </div>

        {loading && (
          <div className="flex flex-col gap-3">
            {[0, 1, 2, 3, 4].map((row) => (
              <div key={row} className="flex flex-row items-center gap-4">
                <Shimmer variant="rounded" width={46} height={46} />
                <div className="flex-1">
                  <Shimmer variant="text" width="60%" className="mb-[5px]" />
                  <Shimmer variant="text" width="35%" />
                </div>
              </div>
            ))}
          </div>
        )}

        {error && <EmptyState title="Search failed" hint={error} />}

        {!loading && !error && query && !results.length && (
          <EmptyState title={`No results for “${query}”`} hint="Check the spelling or try another filter." />
        )}

        {!loading && songs.length > 0 && (
          <div>
            <p className="m-0 mb-1 text-base font-semibold">Songs</p>
            <TrackList tracks={songs} />
          </div>
        )}

        {!loading && others.length > 0 && (
          <div>
            <p className="m-0 mb-2 text-base font-semibold">
              {songs.length ? 'More results' : 'Results'}
            </p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-5 md:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
              {others.map((item, index) => (
                <MediaCard
                  key={cardKey(item, index)}
                  item={item}
                  width="100%"
                  songsContext={songs}
                  onPlaySong={(raw) => player.playTrack(raw, songs)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* The pasted-link import flow: opens prefilled and auto-advances;
          the saved playlist lives in the Library. */}
      <SpotifyImportDialog
        open={importUrl !== null}
        initialUrl={importUrl ?? undefined}
        onClose={() => setImportUrl(null)}
        onOpenPlaylist={() => {
          setImportUrl(null);
          navigate('/library');
        }}
      />
    </Container>
  );
}
