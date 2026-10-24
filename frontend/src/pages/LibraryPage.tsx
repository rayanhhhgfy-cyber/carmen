/**
 * Library — an Apple Music style tabbed hub: one sticky tab bar (Songs,
 * Favorites, Artists, Albums, Playlists, Recent) with exactly one page mounted
 * below it, so a tab switch unmounts the page behind it instead of stacking
 * every section on one long scroll.
 *
 * The selected tab is mirrored into `sessionStorage` — deliberately not the
 * app-state DB row, so hopping to a collection and back (or a route restore)
 * keeps the tab while a fresh launch defaults to Songs.
 *
 * Selecting a playlist still swaps the content area for an in-page detail
 * view instead of a route (the route stays `/library`), so closing it
 * remounts the Playlists page and it reloads its data on its own.
 */
import { useCallback, useEffect, useState } from 'react';

import { Container, Tab, Tabs } from '../components/ui';
import { listDownloads } from '../db/repos/downloads';
import { runSmartDownloadsFromApp } from '../services/smartDownloads';
import { useEffectsEnabled } from '../settings/store';
import type { DownloadedSong } from '../types/models';
import { cn } from '../utils/cn';
import AlbumsSection from './library/AlbumsSection';
import ArtistsSection from './library/ArtistsSection';
import FavoritesSection from './library/FavoritesSection';
import PlaylistsSection from './library/PlaylistsSection';
import PlaylistDetailView from './library/PlaylistDetailView';
import RecentSection from './library/RecentSection';
import SongsSection from './library/SongsSection';
import { LibraryIcon } from './library/glyphs';

/** The six Library tabs, in display order. */
const TAB_IDS = ['songs', 'favorites', 'artists', 'albums', 'playlists', 'recent'] as const;
type LibraryTab = (typeof TAB_IDS)[number];

const TAB_LABELS: Record<LibraryTab, string> = {
  songs: 'Songs',
  favorites: 'Favorites',
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
  // Smart downloads re-run on Library visits: this is what picks up a
  // newly favourited PLAYLIST (playlist favourites do not patch the
  // flags store, so the favourites watcher cannot see them) and any
  // favourite added while the app was elsewhere. The run itself is
  // cheap when nothing is new — already-downloaded tracks are skipped
  // twice over — and a no-op when both smart toggles are off.
  useEffect(() => {
    void runSmartDownloadsFromApp().catch(() => {});
  }, []);

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

  // MIGRATION: the kit Tabs calls `onChange(value)` — no MUI event argument.
  const handleTabChange = (next: unknown) => {
    if ((TAB_IDS as readonly string[]).includes(next as string)) {
      selectTab(next as LibraryTab);
    }
  };

  return (
    <Container maxWidth="lg" className="pb-8 pt-4 md:pb-12 md:pt-6">
      <div className="mb-4 flex items-center gap-3">
        <LibraryIcon color="primary" sx={{ fontSize: 34 }} />
        <div className="min-w-0">
          <h5 className="m-0 text-2xl font-extrabold leading-[1.2]">Library</h5>
          <span className="text-xs leading-[1.4] text-muted">
            Playlists, downloads and collections on this device
          </span>
        </div>
      </div>

      {/* Sticky under the app bar's Toolbar (56/64px); translucent + blurred
          like the bar itself so rows fade away beneath it while scrolling —
          the blur drops out in low battery mode (the tint alone still
          separates it from the rows underneath).
          MIGRATION: `scrollButtons="auto"` / `allowScrollButtonsMobile` dropped
          — the kit strip scrolls natively with hidden scrollbars. */}
      <Tabs
        value={tab}
        onChange={handleTabChange}
        variant="scrollable"
        aria-label="Library sections"
        className={cn(
          // sticks to the top of `<main>` — the app header sits above the
          // scrollport (Layout), so no top offset is needed anymore
          'sticky top-0 mb-5 min-h-[46px] border-b border-line bg-bg/[0.92] dark:bg-bg/[0.88]',
          effectsEnabled && 'backdrop-blur-[12px]',
        )}
      >
        {TAB_IDS.map((id) => (
          <Tab key={id} value={id} label={TAB_LABELS[id]} className="!font-bold" />
        ))}
      </Tabs>

      {/* Exactly one page mounted at a time. */}
      {selectedId !== null ? (
        <PlaylistDetailView playlistId={selectedId} onBack={handleBack} />
      ) : (
        <>
          {tab === 'songs' && <SongsSection />}
          {tab === 'favorites' && <FavoritesSection />}
          {tab === 'artists' && <ArtistsSection songs={downloads} loading={downloadsLoading} />}
          {tab === 'albums' && <AlbumsSection songs={downloads} loading={downloadsLoading} />}
          {tab === 'playlists' && <PlaylistsSection onOpen={setSelectedId} />}
          {tab === 'recent' && <RecentSection />}
        </>
      )}
    </Container>
  );
}
