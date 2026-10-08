/**
 * Library — an Apple Music style tabbed hub: one sticky tab bar (Songs,
 * Artists, Albums, Playlists, Recent) with exactly one page mounted below
 * it, so a tab switch unmounts the page behind it instead of stacking every
 * section on one long scroll.
 *
 * The selected tab is mirrored into `sessionStorage` — deliberately not the
 * app-state DB row, so hopping to a collection and back (or a route restore)
 * keeps the tab while a fresh launch defaults to Songs.
 *
 * Selecting a playlist still swaps the content area for an in-page detail
 * view instead of a route (the route stays `/library`), so closing it
 * remounts the Playlists page and it reloads its data on its own.
 */
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { Box, Container, Tab, Tabs, Typography } from '@mui/material';

import { listDownloads } from '../db/repos/downloads';
import { useEffectsEnabled } from '../settings/store';
import type { DownloadedSong } from '../types/models';
import AlbumsSection from './library/AlbumsSection';
import ArtistsSection from './library/ArtistsSection';
import PlaylistsSection from './library/PlaylistsSection';
import PlaylistDetailView from './library/PlaylistDetailView';
import RecentSection from './library/RecentSection';
import SongsSection from './library/SongsSection';
import { LibraryIcon } from './library/glyphs';

/** The five Library tabs, in display order. */
const TAB_IDS = ['songs', 'artists', 'albums', 'playlists', 'recent'] as const;
type LibraryTab = (typeof TAB_IDS)[number];

const TAB_LABELS: Record<LibraryTab, string> = {
  songs: 'Songs',
  artists: 'Artists',
  albums: 'Albums',
  playlists: 'Playlists',
  recent: 'Recent',
};

/** Session-scoped key — no DB table / setting for a view preference. */
const TAB_STORAGE_KEY = 'carmen.library.tab';

/** Restores the last tab, falling back to Songs (also on blocked storage). */
function readStoredTab(): LibraryTab {
  try {
    const stored = sessionStorage.getItem(TAB_STORAGE_KEY);
    if (stored && (TAB_IDS as readonly string[]).includes(stored)) return stored as LibraryTab;
  } catch {
    // storage can be unavailable (private mode / hardened webview) — default.
  }
  return 'songs';
}

export default function LibraryPage() {
  const [tab, setTab] = useState<LibraryTab>(readStoredTab);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [downloads, setDownloads] = useState<DownloadedSong[]>([]);
  const [downloadsLoading, setDownloadsLoading] = useState(true);
  const effectsEnabled = useEffectsEnabled();

  // One read of the offline catalogue feeds the Albums & Artists grouping;
  // the Songs page runs its own sorted query and the detail view swaps the
  // content area (remounting the pages behind it when it closes).
  //
  // Started on first arrival on a catalogue tab and kept here rather than
  // inside the pages, so Albums ↔ Artists reuses the same data. No
  // cancellation guard: a write landing after a navigation is a harmless
  // no-op in React 18, and re-entering the tabs simply re-runs the effect
  // (fresh data, like the old per-section loads).
  const wantsCatalogue = tab === 'albums' || tab === 'artists';
  useEffect(() => {
    if (!wantsCatalogue) return;
    setDownloadsLoading(true);
    listDownloads()
      .then((rows) => {
        setDownloads(rows);
        setDownloadsLoading(false);
      })
      .catch((loadError) => {
        console.warn('[library] load catalogue failed', loadError);
        setDownloadsLoading(false);
      });
  }, [wantsCatalogue]);

  // Stable identity: the detail view keys its load effect on this callback.
  const handleBack = useCallback(() => setSelectedId(null), []);

  const selectTab = useCallback((next: LibraryTab) => {
    setTab(next);
    // Switching tabs dismisses an open playlist detail — the detail belongs
    // to the Playlists page that launched it.
    setSelectedId(null);
    try {
      sessionStorage.setItem(TAB_STORAGE_KEY, next);
    } catch {
      // Persisting is best-effort; the tab still works for this session.
    }
  }, []);

  const handleTabChange = (_event: SyntheticEvent, next: unknown) => {
    if ((TAB_IDS as readonly string[]).includes(next as string)) {
      selectTab(next as LibraryTab);
    }
  };

  return (
    <Container maxWidth="lg" sx={{ pt: { xs: 2, md: 3 }, pb: { xs: 4, md: 6 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
        <LibraryIcon color="primary" sx={{ fontSize: 34 }} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
            Library
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Playlists, downloads and collections on this device
          </Typography>
        </Box>
      </Box>

      {/* Sticky under the app bar's Toolbar (56/64px); translucent + blurred
          like the bar itself so rows fade away beneath it while scrolling —
          the blur drops out in high performance mode (the tint alone still
          separates it from the rows underneath). */}
      <Tabs
        value={tab}
        onChange={handleTabChange}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        aria-label="Library sections"
        sx={{
          position: 'sticky',
          top: { xs: 56, md: 64 },
          mb: 2.5,
          minHeight: 46,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: (theme) =>
            theme.palette.mode === 'dark' ? 'rgba(10,13,11,0.88)' : 'rgba(246,247,246,0.92)',
          backdropFilter: effectsEnabled ? 'blur(12px)' : 'none',
          '& .MuiTab-root': { textTransform: 'none', fontWeight: 700 },
        }}
      >
        {TAB_IDS.map((id) => (
          <Tab key={id} value={id} label={TAB_LABELS[id]} />
        ))}
      </Tabs>

      {/* Exactly one page mounted at a time. */}
      {selectedId !== null ? (
        <PlaylistDetailView playlistId={selectedId} onBack={handleBack} />
      ) : (
        <>
          {tab === 'songs' && <SongsSection />}
          {tab === 'artists' && <ArtistsSection songs={downloads} loading={downloadsLoading} />}
          {tab === 'albums' && <AlbumsSection songs={downloads} loading={downloadsLoading} />}
          {tab === 'playlists' && <PlaylistsSection onOpen={setSelectedId} />}
          {tab === 'recent' && <RecentSection />}
        </>
      )}
    </Container>
  );
}
