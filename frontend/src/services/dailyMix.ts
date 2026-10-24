/**
 * Daily Mix — client-generated, from the user's OWN library + favorites.
 *
 * Server-free by design: the live site talks to the upstream demo API,
 * which knows nothing about this user's library, so the mix is built
 * entirely on the client from tracks already stored locally (favorites,
 * playlist tracks, recent plays, suggestions).
 *
 * Determinism: for a given day + library the mix is identical. A
 * 32-bit FNV-1a hash of the date key + the sorted track ids seeds a
 * mulberry32 PRNG, so shuffling never depends on `Math.random` or on
 * call order. The one deliberate exception is the "More like" seed
 * expansion: related tracks are fetched from the live API
 * (`GET /browsing/related/{videoId}` — the same endpoint the player
 * uses for its Related tab) and passed in as input, so the mix stays
 * deterministic *for given inputs*; a different related payload is a
 * different input, not randomness.
 *
 * Explainability: every section carries a `reason` naming the taste
 * signal it came from ("From your favourites", "Because you liked X",
 * "More like Y"). No section is random filler presented as taste — a
 * section only exists when its signal exists, and an empty library
 * yields an empty mix, never invented tracks.
 *
 * Freshness: the mix is date-keyed in local storage (`carmen:daily-mix:v1`).
 * The stored mix for today is reused across launches; a new calendar
 * day, or an explicit force-refresh, generates a new one. A stored
 * *empty* mix is not sticky: if the library was empty when it was made
 * and now has tracks, the next load regenerates instead of serving the
 * empty shell all day.
 */
import { apiGet } from '../api';
import type { Track } from '../types/models';
import { normalizeList } from '../utils/track';

/** Section ids, in the order sections are presented. */
export type DailyMixSectionId = 'favorites' | 'liked-artist' | 'more-like' | 'library';

/** One explainable block of a Daily Mix. */
export interface DailyMixSection {
  id: DailyMixSectionId;
  /** Section heading shown in the UI. */
  title: string;
  /** The taste signal behind the section — always shown beside it. */
  reason: string;
  tracks: Track[];
}

/** A whole day's mix. */
export interface DailyMix {
  /** Local `YYYY-MM-DD` the mix was generated for. */
  date: string;
  sections: DailyMixSection[];
  totalTracks: number;
}

/** Everything generation needs — all of it local except `relatedBySeed`. */
export interface DailyMixInput {
  /** Favorited tracks, in the order the library lists them. */
  favorites: Track[];
  /** All other library tracks: playlist tracks, recents, suggestions. */
  library: Track[];
  /**
   * Related tracks per seed videoId, e.g. from
   * {@link fetchRelatedTracks}. Only seeds that are favorites are used,
   * and the first favorite (in list order) with a non-empty related list
   * wins the "More like" section.
   */
  relatedBySeed?: Record<string, Track[]>;
}

const FAVORITES_CAP = 25;
const LIKED_ARTIST_CAP = 15;
const MORE_LIKE_CAP = 20;
const LIBRARY_CAP = 25;

/** localStorage key for the date-keyed mix cache. */
export const DAILY_MIX_STORAGE_KEY = 'carmen:daily-mix:v1';

/** Minimal storage surface — injectable so tests never touch localStorage. */
export interface MixStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** In-memory storage, used when localStorage is unavailable (tests, SSR). */
export function createMemoryStorage(initial: Record<string, string> = {}): MixStorage {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

let memoryFallback: MixStorage | null = null;

/** The real storage when available, an in-memory stand-in otherwise. */
export function defaultMixStorage(): MixStorage {
  try {
    if (typeof localStorage !== 'undefined' && localStorage !== null) {
      return localStorage;
    }
  } catch {
    /* blocked storage falls through to memory */
  }
  if (!memoryFallback) memoryFallback = createMemoryStorage();
  return memoryFallback;
}

/** Local calendar day as `YYYY-MM-DD` (local timezone, not UTC). */
export function todayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** FNV-1a 32-bit hash — stable across runs, unlike `Math.random`. */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 — a tiny seeded PRNG with a full 32-bit period. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle driven by a seeded PRNG — never `Math.random`. */
export function seededShuffle<T>(items: T[], seed: number): T[] {
  const copy = [...items];
  const random = seededRandom(seed);
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function trackKey(track: Track): string {
  return track.videoId;
}

/** The artist a track is credited to, or null when it carries no name. */
function artistOf(track: Track): string | null {
  const name = (track.artist || '').trim();
  return name && name !== 'Unknown artist' ? name : null;
}

/**
 * Most frequent artist across the given tracks. Ties break
 * alphabetically so the winner never depends on input order.
 */
export function topArtist(tracks: Track[]): string | null {
  const counts = new Map<string, number>();
  for (const track of tracks) {
    const artist = artistOf(track);
    if (artist) counts.set(artist, (counts.get(artist) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [artist, count] of [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (count > bestCount) {
      best = artist;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Generate a Daily Mix — pure and deterministic: the same inputs and
 * date key always produce the same sections in the same order.
 *
 * Deduplication runs across sections in presentation order, so a track
 * appears at most once in the whole mix: favorites first, then the
 * liked-artist block, then "More like", then the library remainder.
 */
export function generateDailyMix(input: DailyMixInput, date: string): DailyMix {
  const favorites = input.favorites.filter((track) => track?.videoId);
  const library = input.library.filter((track) => track?.videoId);
  const relatedBySeed = input.relatedBySeed ?? {};

  const poolIds = [...favorites, ...library]
    .map(trackKey)
    .sort()
    .join(',');
  const seed = hashSeed(`${date}|${poolIds}`);
  const used = new Set<string>();
  const take = (tracks: Track[], cap: number): Track[] => {
    const picked: Track[] = [];
    for (const track of tracks) {
      if (picked.length >= cap) break;
      if (used.has(track.videoId)) continue;
      used.add(track.videoId);
      picked.push(track);
    }
    return picked;
  };

  const sections: DailyMixSection[] = [];

  if (favorites.length) {
    const picked = take(seededShuffle(favorites, seed ^ 0x9e3779b9), FAVORITES_CAP);
    if (picked.length) {
      sections.push({
        id: 'favorites',
        title: 'From your favourites',
        reason: 'Songs you marked as favourites',
        tracks: picked,
      });
    }
  }

  const liked = topArtist([...favorites, ...library]);
  if (liked) {
    const byArtist = [...favorites, ...library].filter((track) => artistOf(track) === liked);
    const picked = take(seededShuffle(byArtist, seed ^ 0x51ed2701), LIKED_ARTIST_CAP);
    if (picked.length) {
      sections.push({
        id: 'liked-artist',
        title: `Because you liked ${liked}`,
        reason: `More songs by ${liked} from your library and favourites`,
        tracks: picked,
      });
    }
  }

  for (const favorite of favorites) {
    const related = (relatedBySeed[favorite.videoId] ?? []).filter((track) => track?.videoId);
    if (!related.length) continue;
    const picked = take(related, MORE_LIKE_CAP);
    if (!picked.length) continue;
    const seedArtist = artistOf(favorite);
    sections.push({
      id: 'more-like',
      title: `More like ${favorite.title}`,
      reason: seedArtist
        ? `Songs related to ${favorite.title} by ${seedArtist}`
        : `Songs related to ${favorite.title}`,
      tracks: picked,
    });
    break;
  }

  const libraryPicked = take(seededShuffle(library, seed ^ 0x85ebca6b), LIBRARY_CAP);
  if (libraryPicked.length) {
    sections.push({
      id: 'library',
      title: 'From your library',
      reason: 'Songs from your playlists and library, picked for today',
      tracks: libraryPicked,
    });
  }

  return {
    date,
    sections,
    totalTracks: sections.reduce((sum, section) => sum + section.tracks.length, 0),
  };
}

/** Read the cached mix, if any (corrupt JSON is ignored, not thrown). */
export function loadDailyMix(storage: MixStorage = defaultMixStorage()): DailyMix | null {
  try {
    const raw = storage.getItem(DAILY_MIX_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DailyMix;
    if (!parsed || typeof parsed.date !== 'string' || !Array.isArray(parsed.sections)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persist a generated mix under the date key. Failures are swallowed. */
export function saveDailyMix(mix: DailyMix, storage: MixStorage = defaultMixStorage()): void {
  try {
    storage.setItem(DAILY_MIX_STORAGE_KEY, JSON.stringify(mix));
  } catch {
    /* a blocked store must not break playback or browsing */
  }
}

/**
 * The mix for today: the cached one when it is for today (and not an
 * empty shell made when the library was empty), otherwise a freshly
 * generated one that is then cached. `force` always regenerates.
 */
export function getDailyMix(
  input: DailyMixInput,
  options: { force?: boolean; dateKey?: string; storage?: MixStorage } = {},
): DailyMix {
  const storage = options.storage ?? defaultMixStorage();
  const date = options.dateKey ?? todayKey();
  const hasTracks = input.favorites.length > 0 || input.library.length > 0;
  if (!options.force) {
    const cached = loadDailyMix(storage);
    if (cached && cached.date === date && (cached.totalTracks > 0 || !hasTracks)) {
      return cached;
    }
  }
  const fresh = generateDailyMix(input, date);
  saveDailyMix(fresh, storage);
  return fresh;
}

/**
 * Related tracks for one seed song, via the web client's existing
 * related-tracks endpoint (`GET /browsing/related/{videoId}` — the
 * endpoint PlayerContext already uses for the Related tab). Failures
 * resolve to an empty list: a missing "More like" section is better
 * than a broken mix.
 */
export async function fetchRelatedTracks(
  videoId: string,
  signal?: AbortSignal,
): Promise<Track[]> {
  try {
    const payload = await apiGet(`/browsing/related/${encodeURIComponent(videoId)}`, { limit: 25 }, signal);
    return normalizeList(Array.isArray(payload) ? payload : payload?.items ?? payload?.tracks ?? []);
  } catch {
    return [];
  }
}
