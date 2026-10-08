/**
 * Songs page — the Library's Songs tab: every downloaded song, with sorting
 * (title / release / artist, each direction), the favorites quick-filter,
 * Play All / Shuffle All and per-row hearts + "add to playlist". The tab bar
 * owns the title, so the page opens with the summary line only.
 *
 * The repo owns the SQL, so each control is one `listDownloads` query; a
 * heart toggle only refetches when the favorites filter is active (the row
 * would otherwise stay behind), otherwise it patches the row in place.
 */
import { useEffect, useState } from 'react';
import { Box, Button, Chip, IconButton, Skeleton, Stack, Tooltip } from '@mui/material';

import { listDownloads } from '../../db/repos/downloads';
import type { SortDir, SortKey } from '../../db/repos/tracks';
import { usePlayer } from '../../player/PlayerContext';
import type { DownloadedSong } from '../../types/models';
import { shuffleList } from '../../utils/library';
import { EmptyHint, PageSummary } from './common';
import {
  ChevronRightIcon,
  DownloadIcon,
  HeartFilledIcon,
  PlayArrowIcon,
  ShuffleIcon,
  SortIcon,
} from './glyphs';
import SongRow from './SongRow';

/** The three sort keys offered by the control, in display order. */
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'releaseDate', label: 'Release' },
  { key: 'artist', label: 'Artist' },
];

export default function SongsSection() {
  const player = usePlayer();
  const [songs, setSongs] = useState<DownloadedSong[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>('title');
  const [dir, setDir] = useState<SortDir>('asc');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  // Bumped to force a refetch without touching the query keys.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listDownloads({ sort, dir, favoritesOnly })
      .then((rows) => {
        if (!cancelled) {
          setSongs(rows);
          setLoading(false);
        }
      })
      .catch((loadError) => {
        console.warn('[library] load downloads failed', loadError);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sort, dir, favoritesOnly, reloadKey]);

  const pickSort = (key: SortKey) => {
    if (key === sort) setDir((current) => (current === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(key);
      setDir('asc');
    }
  };

  const handleFavoriteChange = (videoId: string, next: boolean) => {
    if (favoritesOnly) {
      setReloadKey((key) => key + 1);
      return;
    }
    setSongs((rows) =>
      rows.map((row) => (row.videoId === videoId ? { ...row, isFavorite: next } : row)),
    );
  };

  const playAll = () => player.playAll(songs, 0);

  const shuffleAll = () => {
    if (!songs.length) return;
    if (!player.shuffle) player.toggleShuffle();
    player.playAll(shuffleList(songs), 0);
  };

  const direction = dir === 'asc' ? '↑' : '↓';

  return (
    <Box component="section">
      <PageSummary>
        {loading && !songs.length
          ? 'Loading…'
          : `${songs.length} downloaded song${songs.length === 1 ? '' : 's'} on this device`}
      </PageSummary>

      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        useFlexGap
        flexWrap="wrap"
        sx={{ mb: 1.5, rowGap: 1 }}
      >
        {/* Sort: key chips + a direction toggle; the active chip shows ↑ / ↓. */}
        <Stack direction="row" alignItems="center" spacing={0.75}>
          <SortIcon fontSize="small" sx={{ color: 'text.secondary' }} aria-hidden />
          {SORT_OPTIONS.map((option) => {
            const active = sort === option.key;
            return (
              <Chip
                key={option.key}
                size="small"
                label={active ? `${option.label} ${direction}` : option.label}
                color={active ? 'primary' : 'default'}
                variant={active ? 'filled' : 'outlined'}
                onClick={() => pickSort(option.key)}
                aria-label={`Sort by ${option.label}${active ? ` (${dir === 'asc' ? 'ascending' : 'descending'})` : ''}`}
              />
            );
          })}
          <Tooltip title={dir === 'asc' ? 'Ascending — switch to descending' : 'Descending — switch to ascending'}>
            <IconButton
              size="small"
              aria-label={dir === 'asc' ? 'Switch to descending' : 'Switch to ascending'}
              onClick={() => setDir((current) => (current === 'asc' ? 'desc' : 'asc'))}
            >
              <ChevronRightIcon
                sx={{
                  fontSize: 18,
                  transform: dir === 'asc' ? 'rotate(-90deg)' : 'rotate(90deg)',
                  transition: 'transform 200ms',
                }}
              />
            </IconButton>
          </Tooltip>
        </Stack>

        <Chip
          size="small"
          icon={<HeartFilledIcon />}
          label="Favorites"
          color="primary"
          variant={favoritesOnly ? 'filled' : 'outlined'}
          onClick={() => setFavoritesOnly((value) => !value)}
          aria-label="Only show favorites"
        />

        <Stack direction="row" spacing={1} sx={{ ml: { xs: 0, sm: 'auto' } }}>
          <Button
            size="small"
            variant="contained"
            startIcon={<PlayArrowIcon />}
            disabled={!songs.length}
            onClick={playAll}
          >
            Play all
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<ShuffleIcon />}
            disabled={!songs.length}
            onClick={shuffleAll}
          >
            Shuffle all
          </Button>
        </Stack>
      </Stack>

      {loading && !songs.length ? (
        <Box>
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} variant="rounded" height={54} sx={{ mb: 1 }} />
          ))}
        </Box>
      ) : songs.length === 0 ? (
        favoritesOnly ? (
          <EmptyHint
            title="No favorites here yet"
            hint="Tap the heart on a downloaded song to keep it in this filter."
          />
        ) : (
          <EmptyHint
            icon={<DownloadIcon sx={{ fontSize: 40 }} />}
            title="No downloads yet"
            hint="Download songs from Home or Search — they will show up here, ready to play offline."
          />
        )
      ) : (
        <Box>
          {songs.map((song) => (
            <SongRow
              key={song.videoId}
              track={song}
              contextTracks={songs}
              showDownloaded
              showAddToPlaylist
              onFavoriteChange={handleFavoriteChange}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}
